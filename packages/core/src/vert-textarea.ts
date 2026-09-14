import type { Backend, BackendFactory, CompositionRange, ViewState } from "./backend";
import { HiddenInput } from "./input/hidden-input";
import type { EditKind } from "./model/history";
import { History } from "./model/history";
import { type Caret, type Goal, moveInline } from "./model/movement";
import { stepGrapheme, stepWord } from "./text/segment";
import {
  type ResolvedOptions,
  resolveOptions,
  type Selection,
  type VertTextareaOptions,
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
export class VertTextarea {
  readonly container: HTMLElement;

  protected backend: Backend;
  private input: HiddenInput;
  private history = new History();
  private options: ResolvedOptions;
  private callbacks: VertTextareaOptions;

  private text = "";
  private anchor = 0;
  private caret: Caret = { offset: 0, preferEnd: false };
  private goal: Goal = null;
  private composition: Composition | null = null;

  private focused = false;
  private caretOn = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private dragging = false;
  private destroyed = false;
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement, options: VertTextareaOptions, createBackend: BackendFactory) {
    this.container = container;
    this.callbacks = options;
    this.options = resolveOptions(options);

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.style.overflow = "hidden";

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

    this.bindPointer();

    // textarea と同じで、初期のキャレットは文頭に置く
    this.text = normalize(options.value ?? "");
    this.sync();
  }

  // ---- 公開 API ----

  get value(): string {
    return this.text;
  }

  set value(value: string) {
    this.setValue(value);
  }

  setValue(value: string, options: SetValueOptions = {}): void {
    const next = normalize(value);
    if (next === this.text && !options.selection) return;
    if (!options.keepHistory) this.history.clear();

    this.text = next;
    const selection = options.selection ?? { anchor: this.anchor, focus: this.caret.offset };
    this.anchor = clamp(selection.anchor, 0, next.length);
    this.caret = { offset: clamp(selection.focus, 0, next.length), preferEnd: false };
    this.goal = null;
    this.composition = null;

    this.sync();
    if (options.notify) this.callbacks.onChange?.(this.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  get selection(): Selection {
    return { anchor: this.anchor, focus: this.caret.offset };
  }

  set selection(selection: Selection) {
    this.setSelection(selection.anchor, selection.focus);
  }

  setSelection(anchor: number, focus = anchor): void {
    this.anchor = clamp(anchor, 0, this.text.length);
    this.caret = { offset: clamp(focus, 0, this.text.length), preferEnd: false };
    this.goal = null;
    this.history.breakCoalescing();
    this.afterSelectionChange();
  }

  selectAll(): void {
    this.setSelection(0, this.text.length);
  }

  get selectedText(): string {
    const [from, to] = this.range();
    return this.text.slice(from, to);
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
    const snapshot = this.history.undo({ text: this.text, selection: this.selection });
    if (snapshot) this.applySnapshot(snapshot);
  }

  redo(): void {
    const snapshot = this.history.redo({ text: this.text, selection: this.selection });
    if (snapshot) this.applySnapshot(snapshot);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  setOptions(options: VertTextareaOptions): void {
    this.callbacks = { ...this.callbacks, ...options };
    this.options = resolveOptions(this.callbacks);
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopBlink();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.input.destroy();
    this.backend.destroy();
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
    this.history.breakCoalescing();
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
    const accel = event.metaKey || event.ctrlKey;
    const shift = event.shiftKey;
    const word = event.altKey;

    switch (event.key) {
      // 縦書きでは行の中は上下、行送りは左右
      case "ArrowDown":
        event.preventDefault();
        this.moveCaret(
          accel
            ? this.backend.lineEdge(this.caret, "end")
            : moveInline(this.text, this.caret, 1, word),
          shift,
        );
        return;
      case "ArrowUp":
        event.preventDefault();
        this.moveCaret(
          accel
            ? this.backend.lineEdge(this.caret, "start")
            : moveInline(this.text, this.caret, -1, word),
          shift,
        );
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (accel) this.moveCaret({ offset: this.text.length, preferEnd: true }, shift);
        else this.moveAcross(1, shift);
        return;
      case "ArrowRight":
        event.preventDefault();
        if (accel) this.moveCaret({ offset: 0, preferEnd: false }, shift);
        else this.moveAcross(-1, shift);
        return;
      case "Home":
        event.preventDefault();
        this.moveCaret(this.backend.lineEdge(this.caret, "start"), shift);
        return;
      case "End":
        event.preventDefault();
        this.moveCaret(this.backend.lineEdge(this.caret, "end"), shift);
        return;
      case "PageDown":
      case "PageUp": {
        event.preventDefault();
        const step = event.key === "PageDown" ? 1 : -1;
        const result = this.movePage(step);
        this.moveCaret(result.caret, shift, result.goal);
        return;
      }
      case "Backspace":
        event.preventDefault();
        this.deleteBy(-1, word);
        return;
      case "Delete":
        event.preventDefault();
        this.deleteBy(1, word);
        return;
      case "Enter":
        event.preventDefault();
        this.handleInsert("\n");
        return;
      case "Escape":
        return;
      default:
        break;
    }

    if (accel && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if (accel && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (shift) this.redo();
      else this.undo();
      return;
    }
    if (accel && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
    }
  }

  private deleteBy(direction: 1 | -1, byWord: boolean): void {
    if (this.options.readOnly || this.options.disabled) return;
    const [from, to] = this.range();
    if (from !== to) {
      this.replace(from, to, "", "delete");
      return;
    }
    const at = this.caret.offset;
    const other = byWord
      ? stepWord(this.text, at, direction)
      : stepGrapheme(this.text, at, direction);
    if (other === at) return;
    this.replace(Math.min(at, other), Math.max(at, other), "", "delete");
  }

  private replace(from: number, to: number, insert: string, kind: EditKind): void {
    const room = this.options.maxLength - (this.text.length - (to - from));
    const text = room >= insert.length ? insert : insert.slice(0, Math.max(0, room));
    if (from === to && text.length === 0) return;

    this.history.push({ text: this.text, selection: this.selection }, kind);
    this.text = this.text.slice(0, from) + text + this.text.slice(to);

    const at = from + text.length;
    this.anchor = at;
    this.caret = { offset: at, preferEnd: true };
    this.goal = null;

    this.resetBlink();
    this.sync();
    this.callbacks.onChange?.(this.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  private applySnapshot(snapshot: { text: string; selection: Selection }): void {
    this.text = snapshot.text;
    this.anchor = clamp(snapshot.selection.anchor, 0, this.text.length);
    this.caret = { offset: clamp(snapshot.selection.focus, 0, this.text.length), preferEnd: false };
    this.goal = null;
    this.composition = null;
    this.sync();
    this.callbacks.onChange?.(this.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  // ---- 選択 ----

  private range(): [number, number] {
    const a = this.anchor;
    const b = this.caret.offset;
    return a <= b ? [a, b] : [b, a];
  }

  private moveCaret(caret: Caret, extend: boolean, goal: Goal = null): void {
    this.caret = caret;
    this.goal = goal;
    if (!extend) this.anchor = caret.offset;
    this.history.breakCoalescing();
    this.afterSelectionChange();
  }

  private moveAcross(direction: 1 | -1, extend: boolean): void {
    const result = this.backend.moveAcross(this.caret, direction, this.goal);
    this.moveCaret(result.caret, extend, result.goal);
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

  private bindPointer(): void {
    const surface = this.backend.surface;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      surface.addEventListener(type, listener as EventListener, options);
      this.disposers.push(() =>
        surface.removeEventListener(type, listener as EventListener, options),
      );
    };

    on("pointerdown", (event) => {
      if (event.button !== 0 || this.options.disabled) return;
      event.preventDefault();
      this.input.focus();

      const hit = this.backend.hitTest(event.clientX, event.clientY);
      if (event.detail >= 3) {
        this.selectParagraph(hit.offset);
        return;
      }
      if (event.detail === 2) {
        this.selectWord(hit.offset);
        return;
      }

      this.dragging = true;
      surface.setPointerCapture(event.pointerId);
      this.caret = hit;
      if (!event.shiftKey) this.anchor = hit.offset;
      this.goal = null;
      this.history.breakCoalescing();
      this.afterSelectionChange();
    });

    on("pointermove", (event) => {
      if (!this.dragging) return;
      this.caret = this.backend.hitTest(event.clientX, event.clientY);
      this.goal = null;
      this.afterSelectionChange();
    });

    const stop = (event: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (surface.hasPointerCapture(event.pointerId)) {
        surface.releasePointerCapture(event.pointerId);
      }
    };
    on("pointerup", stop);
    on("pointercancel", stop);
  }

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
      caretVisible: this.caretOn,
      focused: this.focused,
      composition: this.compositionRange(),
      placeholder:
        this.text.length === 0 && !this.composition && this.options.placeholder
          ? this.options.placeholder
          : null,
    };
  }

  /** 組み直して、キャレットを見える位置に置く */
  protected sync(): void {
    if (this.destroyed) return;
    const caret = this.displayCaret();
    this.backend.update(this.viewState());
    this.backend.ensureVisible(caret);

    // IME の候補ウィンドウをキャレットの隣に出させる
    const rect = this.backend.caretRect(caret);
    this.input.moveTo(rect.x - rect.size / 2, rect.y, this.options.font.size);
  }

  private handleFocus(): void {
    this.focused = true;
    this.startBlink();
    this.sync();
    this.callbacks.onFocus?.();
  }

  private handleBlur(): void {
    this.focused = false;
    this.dragging = false;
    this.stopBlink();
    this.history.breakCoalescing();
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
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
