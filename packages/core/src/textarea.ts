import type {
  Backend,
  BackendFactory,
  CaretRect,
  CompositionRange,
  ViewState,
} from "./backend/backend";
import { HiddenInput } from "./input/hidden-input";
import { type Command, commandFor, strokeOf } from "./input/keymap";
import { PointerGestures } from "./input/pointer";
import { normalize, TextDocument } from "./model/document";
import type { EditKind } from "./model/history";
import { type Caret, type Goal, moveInline } from "./model/movement";
import { stepWord } from "./text/segment";
import {
  type ResolvedOptions,
  resolveOptions,
  type Selection,
  type TextareaOptions,
} from "./types";

interface Composition {
  /** 変換中の文字列が入る、確定済みテキスト上の位置 */
  start: number;
  text: string;
  activeStart: number;
  activeEnd: number;
}

export interface SetValueOptions {
  selection?: Selection;
  /** onChange を呼ぶか。既定では呼ばない */
  notify?: boolean;
  keepHistory?: boolean;
}

/**
 * 縦書きテキストエリアの本体。
 * テキスト・履歴・キー操作・IME だけを持ち、組み方と描き方は Backend に委ねる。
 */
export class Textarea {
  readonly container: HTMLElement;

  protected backend: Backend;
  private input: HiddenInput;
  private doc: TextDocument;
  private options: ResolvedOptions;
  private callbacks: TextareaOptions;

  private composition: Composition | null = null;

  // 本文と選択は doc が持つ。ここからは読むだけ
  private get text(): string {
    return this.doc.text;
  }

  private get caret(): Caret {
    return this.doc.caret;
  }

  private get goal(): Goal {
    return this.doc.goal;
  }

  private get anchor(): number {
    return this.doc.selection.anchor;
  }

  private focused = false;
  private caretOn = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private pointer: PointerGestures;
  private destroyed = false;
  /** className で足したぶん。差し替えと後片付けのために覚えておく */
  private ownClasses: string[] = [];
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement, options: TextareaOptions, createBackend: BackendFactory) {
    this.container = container;
    this.callbacks = options;
    this.options = resolveOptions(options);

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.style.overflow = "hidden";
    // 器の寸法を読むのは backend なので、作る前に当てておく
    this.applyClassName(this.options.className);

    this.backend = createBackend(container, this.options);

    this.input = new HiddenInput(container, {
      insert: (text) => this.handleInsert(text),
      compositionStart: () => this.handleCompositionStart(),
      compositionUpdate: (text, from, to) => this.handleCompositionUpdate(text, from, to),
      compositionEnd: (text) => this.handleCompositionEnd(text),
      keyDown: (event) => this.handleKeyDown(event),
      copy: () => this.selectedText,
      cut: () => this.handleCut(),
      paste: (text) => this.handleInsert(text),
      focus: () => this.handleFocus(),
      blur: () => this.handleBlur(),
    });
    this.input.setReadOnly(this.options.readOnly);
    this.input.setDisabled(this.options.disabled);

    this.pointer = new PointerGestures(this.backend.surface, this.backend, this.backend, {
      disabled: () => this.options.disabled,
      placeCaret: (caret, extend) => this.moveCaret(caret, extend),
      selectWord: (offset) => this.selectWord(offset),
      selectParagraph: (offset) => this.selectParagraph(offset),
      focus: () => this.input.focus(),
    });
    this.observeResize();

    // textarea と同じで、初期のキャレットは文頭に置く
    this.doc = new TextDocument(options.value ?? "");
    this.sync();
  }

  // ---- 公開 API ----

  get value(): string {
    return this.doc.text;
  }

  set value(value: string) {
    this.setValue(value);
  }

  setValue(value: string, options: SetValueOptions = {}): void {
    if (!this.doc.reset(value, options.selection, options.keepHistory)) return;
    this.composition = null;
    this.sync();
    if (options.notify) this.callbacks.onChange?.(this.doc.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  get selection(): Selection {
    return this.doc.selection;
  }

  set selection(selection: Selection) {
    this.setSelection(selection.anchor, selection.focus);
  }

  setSelection(anchor: number, focus = anchor): void {
    this.doc.setSelection(anchor, focus);
    this.afterSelectionChange();
  }

  selectAll(): void {
    this.doc.selectAll();
    this.afterSelectionChange();
  }

  get selectedText(): string {
    return this.doc.selectedText;
  }

  insertText(text: string): void {
    this.handleInsert(text);
  }

  focus(): void {
    this.input.focus();
  }

  blur(): void {
    this.input.blur();
  }

  undo(): void {
    if (!this.doc.undo()) return;
    this.composition = null;
    this.afterEdit();
  }

  redo(): void {
    if (!this.doc.redo()) return;
    this.composition = null;
    this.afterEdit();
  }

  get canUndo(): boolean {
    return this.doc.canUndo;
  }

  get canRedo(): boolean {
    return this.doc.canRedo;
  }

  setOptions(options: TextareaOptions): void {
    this.callbacks = { ...this.callbacks, ...options };
    this.options = resolveOptions(this.callbacks);
    this.applyClassName(this.options.className);
    this.backend.setOptions(this.options);
    this.input.setReadOnly(this.options.readOnly);
    this.input.setDisabled(this.options.disabled);
    this.startBlink();
    this.sync();
  }

  /** 行送り方向にどれだけ送られているか (px) */
  get scrollOffset(): number {
    return this.backend.scrollOffset;
  }

  set scrollOffset(value: number) {
    this.backend.scrollOffset = value;
  }

  /** 折り返しを含めた視覚行の数 */
  get lineCount(): number {
    return this.backend.lineCount;
  }

  /** キャレットの居場所。container が原点 */
  get caretRect(): CaretRect {
    return this.backend.caretRect(this.displayCaret());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopBlink();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.pointer.destroy();
    this.input.destroy();
    this.backend.destroy();
    this.applyClassName("");
  }

  /** 自分で足したぶんだけ外して、新しいぶんを足す。元から付いていたものは触らない */
  private applyClassName(className: string): void {
    const next = className.split(/\s+/).filter(Boolean);
    for (const name of this.ownClasses) {
      if (!next.includes(name)) this.container.classList.remove(name);
    }
    for (const name of next) this.container.classList.add(name);
    this.ownClasses = next;
  }

  // ---- 入力 ----

  private handleInsert(raw: string): void {
    if (this.options.readOnly || this.options.disabled) return;
    const text = normalize(raw);
    if (!text) return;
    const [from, to] = this.range();
    this.replace(from, to, text, "input");
  }

  private handleCut(): string {
    const selected = this.selectedText;
    if (!this.options.readOnly && !this.options.disabled && selected) {
      const [from, to] = this.range();
      this.replace(from, to, "", "delete");
    }
    return selected;
  }

  private handleCompositionStart(): void {
    if (this.options.readOnly || this.options.disabled) return;
    const [from, to] = this.range();
    if (from !== to) this.replace(from, to, "", "delete");
    this.doc.breakCoalescing();
    this.composition = { start: this.caret.offset, text: "", activeStart: 0, activeEnd: 0 };
    this.sync();
  }

  private handleCompositionUpdate(text: string, activeStart: number, activeEnd: number): void {
    if (!this.composition) return;
    this.composition = { ...this.composition, text, activeStart, activeEnd };
    this.sync();
  }

  private handleCompositionEnd(text: string): void {
    const composition = this.composition;
    this.composition = null;
    if (!composition) return;
    if (text) this.replace(composition.start, composition.start, normalize(text), "other");
    else this.sync();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.options.disabled) return;
    const command = commandFor(strokeOf(event), this.options.writingMode);
    if (!command) return;
    event.preventDefault();
    this.run(command);
  }

  /** キーの割り当ては keymap.ts。ここは動かし方だけ持つ */
  private run(command: Command): void {
    switch (command.type) {
      case "stepInline":
        this.stepInline(command.direction, command.word, command.extend);
        break;
      case "lineEdge":
        this.moveCaret(this.backend.lineEdge(this.caret, command.edge), command.extend);
        break;
      case "docEdge": {
        const caret: Caret =
          command.edge === "end"
            ? { offset: this.text.length, preferEnd: true }
            : { offset: 0, preferEnd: false };
        this.moveCaret(caret, command.extend);
        break;
      }
      case "paragraphEdge":
        this.moveCaret(this.paragraphEdge(command.direction), command.extend);
        break;
      case "moveAcross":
        this.moveAcross(command.direction, command.extend);
        break;
      case "page": {
        const result = this.movePage(command.direction);
        this.moveCaret(result.caret, command.extend, result.goal);
        break;
      }
      case "delete":
        this.deleteBy(command.direction, command.word);
        break;
      case "insert":
        this.handleInsert(command.text);
        break;
      case "selectAll":
        this.selectAll();
        break;
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
    }
  }

  private deleteBy(direction: 1 | -1, byWord: boolean): void {
    if (this.options.readOnly || this.options.disabled) return;
    if (!this.doc.deleteBy(direction, byWord, this.options.maxLength)) return;
    this.resetBlink();
    this.afterEdit();
  }

  private replace(from: number, to: number, insert: string, kind: EditKind): void {
    if (!this.doc.replace(from, to, insert, kind, this.options.maxLength)) return;
    this.resetBlink();
    this.afterEdit();
  }

  /** 本文が動いたあとの後始末 */
  private afterEdit(): void {
    this.sync();
    this.callbacks.onChange?.(this.doc.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  // ---- 選択 ----

  private range(): [number, number] {
    return this.doc.range();
  }

  private moveCaret(caret: Caret, extend: boolean, goal: Goal = null): void {
    this.doc.moveCaret(caret, extend, goal);
    this.afterSelectionChange();
  }

  /** 矢印ひとつぶんの移動。軸が決まれば、刻みは修飾キーで決まる */
  /**
   * 行の中を 1 つ動く。縦書きでは下 / 上。
   * 選んでいるときの 1 文字ぶんは、選んだ端に畳むだけで進まない (Blink も同じ)。
   */
  private stepInline(direction: 1 | -1, byWord: boolean, extend: boolean): void {
    const [from, to] = this.range();
    if (!extend && !byWord && from !== to) {
      this.moveCaret(
        { offset: direction === 1 ? to : from, preferEnd: this.caret.preferEnd },
        false,
      );
      return;
    }

    const next = moveInline(this.text, this.caret, direction, byWord);
    // 端に着いていて動けないなら何もしない。行を移るときの狙いも消さずに残す
    const anchor = extend ? this.anchor : next.offset;
    if (next.offset === this.caret.offset && anchor === this.anchor) return;
    this.moveCaret(next, extend);
  }

  private moveAcross(direction: 1 | -1, extend: boolean): void {
    const result = this.backend.moveAcross(this.caret, direction, this.goal);
    this.moveCaret(result.caret, extend, result.goal);
  }

  /** 段落の頭 / 末へ。すでに端に居るなら隣の段落まで行く */
  private paragraphEdge(direction: 1 | -1): Caret {
    const at = this.caret.offset;
    if (direction === -1) {
      let start = this.text.lastIndexOf("\n", at - 1) + 1;
      if (start === at) start = this.text.lastIndexOf("\n", at - 2) + 1;
      return { offset: Math.max(0, start), preferEnd: false };
    }
    let end = this.text.indexOf("\n", at);
    if (end === at) end = this.text.indexOf("\n", at + 1);
    return { offset: end === -1 ? this.text.length : end, preferEnd: true };
  }

  private movePage(direction: 1 | -1): { caret: Caret; goal: Goal } {
    let result = { caret: this.caret, goal: this.goal };
    for (let i = 0; i < this.backend.linesPerPage(); i++) {
      result = this.backend.moveAcross(result.caret, direction, result.goal);
    }
    return result;
  }

  private afterSelectionChange(): void {
    this.resetBlink();
    this.sync();
    this.callbacks.onSelectionChange?.(this.selection);
  }

  // ---- ポインタ ----

  private selectWord(offset: number): void {
    const from = stepWord(this.text, Math.min(offset + 1, this.text.length), -1);
    const to = stepWord(this.text, from, 1);
    this.setSelection(from, to);
  }

  private selectParagraph(offset: number): void {
    const from = this.text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const found = this.text.indexOf("\n", offset);
    this.setSelection(from, found === -1 ? this.text.length : found);
  }

  // ---- 表示 ----

  /** 変換中の文字を差し込んだ、画面に出すテキスト */
  private displayText(): string {
    const composition = this.composition;
    if (!composition) return this.text;
    return (
      this.text.slice(0, composition.start) + composition.text + this.text.slice(composition.start)
    );
  }

  /** 描画・当たり判定で使う、変換中の文字を含めたキャレット */
  private displayCaret(): Caret {
    const composition = this.composition;
    if (!composition) return this.caret;
    return { offset: composition.start + composition.activeEnd, preferEnd: true };
  }

  private compositionRange(): CompositionRange | null {
    const composition = this.composition;
    if (!composition || composition.text.length === 0) return null;
    return {
      start: composition.start,
      end: composition.start + composition.text.length,
      activeStart: composition.start + composition.activeStart,
      activeEnd: composition.start + composition.activeEnd,
    };
  }

  private viewState(): ViewState {
    const [from, to] = this.range();
    return {
      text: this.displayText(),
      selection: this.composition ? { start: 0, end: 0 } : { start: from, end: to },
      caret: this.displayCaret(),
      // 選択が伸びている間は出さない。textarea もそうなっている
      caretVisible: this.caretOn && this.anchor === this.caret.offset,
      focused: this.focused,
      composition: this.compositionRange(),
      placeholder:
        this.text.length === 0 && !this.composition && this.options.placeholder
          ? this.options.placeholder
          : null,
    };
  }

  /** 組み直して、キャレットを見える位置に置く */
  /**
   * CSS を読み直して組み直す。
   * 字の大きさ・余白・禁則を CSS で変えたら呼ぶ。
   * 器の寸法だけなら ResizeObserver が拾うので要らない。
   */
  refresh(): void {
    this.backend.refresh();
    this.sync();
  }

  protected sync(): void {
    if (this.destroyed) return;
    const caret = this.displayCaret();
    this.backend.update(this.viewState());
    this.backend.ensureVisible(caret);
    // 送りが落ち着いたいま、キャレットが画面のどこに居るかを控える。
    // 次の組み直しで、そこへ戻す
    this.backend.anchorCaret();

    this.placeInput();
  }

  /** IME の候補ウィンドウをキャレットの隣に出させる */
  private placeInput(): void {
    this.input.moveTo(
      this.backend.caretRect(this.displayCaret()),
      this.options.writingMode,
      this.backend.fontSize,
    );
  }

  /**
   * 器が変われば組み直る。隠し入力もキャレットの脇へ置き直す。
   * 置いたままだと、キーボードで器が縮んだときに入力がその下へ取り残され、
   * iOS が開いた直後にキーボードを閉じてしまう。
   * backend より後に登録する。組み直った結果を見てから動かしたい
   */
  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!this.destroyed && this.focused) this.placeInput();
    });
    observer.observe(this.container);
    this.disposers.push(() => observer.disconnect());
  }

  private handleFocus(): void {
    this.focused = true;
    this.startBlink();
    this.sync();
    this.callbacks.onFocus?.();
  }

  private handleBlur(): void {
    this.focused = false;
    this.pointer.cancelDrag();
    this.stopBlink();
    this.doc.breakCoalescing();
    this.sync();
    this.callbacks.onBlur?.();
  }

  private startBlink(): void {
    this.stopBlink();
    this.caretOn = true;
    const interval = this.options.caretBlinkInterval;
    if (interval <= 0) return;
    this.blinkTimer = setInterval(() => {
      this.caretOn = !this.caretOn;
      if (!this.destroyed) this.backend.update(this.viewState());
    }, interval);
  }

  private stopBlink(): void {
    if (this.blinkTimer !== null) clearInterval(this.blinkTimer);
    this.blinkTimer = null;
    this.caretOn = true;
  }

  private resetBlink(): void {
    if (this.focused) this.startBlink();
  }
}

/** 改行を \n に揃える。textarea もクリップボードも \r\n を投げてくる */
