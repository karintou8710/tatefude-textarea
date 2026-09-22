import type { Backend, CaretRect, ViewState } from "./backend/backend";
import { buildViewState } from "./backend/view-state";
import { type Command, runCommand } from "./edit/command";
import { beginComposition, endComposition, updateComposition } from "./edit/compose";
import {
  breakCoalescing,
  extendTo,
  grabHandle,
  moveCaret,
  selectAll,
  selectParagraph,
  selectWord,
  setSelection,
} from "./edit/selection";
import { cut, insert, redo, reset, undo } from "./edit/text";
import { HiddenInput, type HiddenInputHandlers } from "./input/hidden-input";
import { type PointerActions, PointerGestures } from "./input/pointer";
import type { Input, Pointer } from "./input/receivers";
import { type EditState, type Limits, newEditState, type Result } from "./state/edit";
import { composing, range, selectedText, selection, viewContent } from "./state/query";
import { newScreenState, type ScreenState, setFocused, showHandles } from "./state/screen";
import {
  type Callbacks,
  callbacksOf,
  type ResolvedOptions,
  resolveOptions,
  type SetValueOptions,
  type TextareaCan,
  type TextareaCommands,
  type TextareaOptions,
  type TextareaState,
} from "./types";

/**
 * 外から呼べる操作を、副作用を外した形で並べたもの。
 * 引数は `commands` と同じで、返すのは新しい state だけ
 */
type Operations = {
  [K in keyof TextareaCommands]: (...args: Parameters<TextareaCommands[K]>) => Result;
};

/**
 * 縦書きテキストエリアの本体。
 *
 * 自分では何も計算しない。部品を組み立てて繋ぎ、
 * 「動いたら描き直して知らせる」ところだけを持つ。
 * 編集は `edit/`、レイアウトと描画は Backend、受け口は隠し入力とポインタ。
 *
 * **繋ぎ先は表で持つ。**出来事ごとの行き先は `inputHandlers` / `pointerActions` /
 * `makeCommands` の 3 つに並べてあり、組み立て (constructor) には混ぜない。
 *
 * 隠し入力と指はここで作る。`Textarea` を呼び返すハンドラを持って生まれるので、
 * 外から出来上がりを渡す道は無い。
 */
/**
 * `Textarea` を組むのに要るもの。
 *
 * **部品は生成時に凍る。**あとから差し替えられる `TextareaOptions` と
 * 型を分けてあるのは、`setOptions` に backend を渡せてしまわないため。
 * 渡す側から見ると 1 つの袋だが、動かせる側とそうでない側は型で分かれている。
 */
export interface TextareaInit extends TextareaOptions {
  /**
   * ④ レイアウトと描画。**渡すのはこれだけ。**
   *
   * レイアウトで変わるのは backend だけで、隠し入力と指は container と backend から
   * 機械的に決まる。差し替える相手が居ない口は作らない
   */
  backend: Backend;
}

export class Textarea {
  readonly container: HTMLElement;
  /** 編集の操作。本文と選択を動かすものは全部ここから */
  readonly commands: TextareaCommands;
  /** その操作がいま何か動かすか。ボタンの出し入れに使う */
  readonly can: TextareaCan;

  /**
   * 外から呼べる操作を 1 回だけ並べる。**判断はここだけ。**
   * `commands` (やる) と `can` (動くか) は、どちらもここから導く
   */
  private ops = {
    setValue: (value: string, options: SetValueOptions = {}) =>
      reset(this.editState, value, options.selection, options.keepHistory),
    setSelection: (anchor: number, head = anchor) => setSelection(this.editState, anchor, head),
    selectAll: () => selectAll(this.editState),
    insertText: (text: string) => insert(this.editState, text, this.limits()),
    cut: () => cut(this.editState, this.limits()),
    undo: () => undo(this.editState),
    redo: () => redo(this.editState),
  } satisfies Operations;

  private backend: Backend;
  private editState: EditState;
  private input: Input;
  private pointer: Pointer;
  /** 既定値を埋めた設定。部品に配るのはこちら */
  private options: ResolvedOptions;
  /** 外へ知らせる先。options に混ざって来るが、持ち回すのは別 */
  private callbacks: Callbacks;

  /** 画面の側の状態。編集の状態と同じく、作り直して差し替える */
  private screen = newScreenState;

  private destroyed = false;

  constructor(container: HTMLElement, init: TextareaInit) {
    const backend = init.backend;
    this.container = container;
    this.backend = backend;
    this.callbacks = callbacksOf(init);
    this.options = resolveOptions(init);
    // textarea と同じで、初期のキャレットは文頭に置く
    this.editState = newEditState(init.value ?? "");
    this.commands = this.makeCommands();
    this.can = this.makeCan();

    this.input = new HiddenInput(container, this.inputHandlers(), this.options);
    // クリックした場所が何文字目かと、戻す先を忘れるのに backend を聞く
    this.pointer = new PointerGestures(backend.surface, backend, backend, this.pointerActions());

    this.sync();
  }

  // ---- 公開 API ----

  /** いまの中身。読むだけの写しで、ここを触っても本文は動かない */
  get state(): TextareaState {
    return {
      value: this.editState.text,
      selection: selection(this.editState),
      selectedText: selectedText(this.editState),
      composing: composing(this.editState),
    };
  }

  focus(): void {
    this.input.focus();
  }

  blur(): void {
    this.input.blur();
  }

  setOptions(options: TextareaOptions): void {
    // どちらも差分で来る。前のものに重ねる
    this.callbacks = { ...this.callbacks, ...callbacksOf(options) };
    this.options = resolveOptions({ ...this.options, ...options });
    this.backend.setOptions(this.options);
    this.input.setOptions(this.options);
    this.sync();
  }

  /** ブロック方向へどれだけスクロールしたか (px) */
  get scrollOffset(): number {
    return this.backend.scrollOffset;
  }

  set scrollOffset(value: number) {
    // 外からスクロールした先が見たい位置。クリックした場所へは戻さない (ホイールと同じ扱い)。
    // 解かないと、次にコンテナが変わったとき follow が元の位置へ巻き戻す
    this.backend.forgetAnchor();
    this.backend.scrollOffset = value;
  }

  /**
   * 選択の外接矩形。**container 基準**。選択が無ければ null。
   *
   * クライアント座標にしないのは、「キャレットや選択がコンテナの中に収まっているか」を
   * 言うのがこちらの方が素直だから。画面に浮かせるときは `container` の矩形を足す
   */
  get selectionRect(): CaretRect | null {
    const [from, to] = range(this.editState);
    return this.backend.selectionRect(from, to);
  }

  /** キャレットの居場所。container が原点 */
  get caretRect(): CaretRect {
    return this.backend.caretRect(this.editState.head);
  }

  /**
   * CSS を読み直してレイアウトし直す。
   * 字の大きさ・余白・禁則を CSS で変えたら呼ぶ。
   * コンテナの寸法だけなら ResizeObserver が拾うので要らない。
   */
  refresh(): void {
    this.backend.refresh();
    this.sync();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointer.destroy();
    this.input.destroy();
    this.backend.destroy();
  }

  /**
   * 外から呼ぶ編集の操作。`ops` の結果を `apply` に渡すだけ。
   * ここに残るのは副作用の段取り——通知するか、ハンドルを引っ込めるか、何を返すか
   */
  private makeCommands(): TextareaCommands {
    const ops = this.ops;
    return {
      setValue: (value, options = {}) =>
        this.apply(ops.setValue(value, options), options.notify ?? false),
      setSelection: (anchor, head = anchor) => this.apply(ops.setSelection(anchor, head)),
      selectAll: () => this.apply(ops.selectAll()),
      insertText: (text) => this.handleInsert(text),
      cut: () => {
        const result = ops.cut();
        this.apply(result);
        return result.text;
      },
      undo: () => this.apply(ops.undo()),
      redo: () => this.apply(ops.redo()),
    };
  }

  /**
   * 同じ表を「動くか」に読み替える。**操作を走らせて、state が動くかだけを見る。**
   * `edit/` は副作用を持たないので、走らせても何も起きない——
   * これが `can` を別に書かずに済む理由。
   *
   * 足し忘れは型が止める。`TextareaCan` は `TextareaCommands` から導いてある
   */
  private makeCan(): TextareaCan {
    const ops = this.ops;
    const dryRun =
      <A extends unknown[]>(op: (...args: A) => Result) =>
      (...args: A): boolean =>
        op(...args).changed !== null;
    return {
      setValue: dryRun(ops.setValue),
      setSelection: dryRun(ops.setSelection),
      selectAll: dryRun(ops.selectAll),
      insertText: dryRun(ops.insertText),
      cut: dryRun(ops.cut),
      undo: dryRun(ops.undo),
      redo: dryRun(ops.redo),
    };
  }

  /**
   * 隠し入力から来る出来事の行き先。
   * 「打つ・変換する・キーを押す」は編集操作へ、focus は画面の状態へ。
   * `caretAnchor` だけは逆向きで、受け口から読みに来るもの
   */
  private inputHandlers(): HiddenInputHandlers {
    return {
      insert: (text) => this.handleInsert(text),
      compositionStart: () => this.apply(beginComposition(this.editState, this.limits())),
      compositionUpdate: (text, from, to) =>
        this.apply(updateComposition(this.editState, text, from, to, this.limits())),
      compositionEnd: (text) => this.apply(endComposition(this.editState, text, this.limits())),
      keyDown: (command) => this.handleKeyDown(command),
      caretAnchor: () => ({
        rect: this.backend.caretRect(this.editState.head),
        size: this.backend.fontSize,
      }),
      copy: () => selectedText(this.editState),
      cut: () => this.commands.cut(),
      paste: (text) => this.handleInsert(text),
      focus: () => this.handleFocus(),
      blur: () => this.handleBlur(),
    };
  }

  /** 指とマウスから来る出来事の行き先。ハンドルの出し入れだけが画面の状態 */
  private pointerActions(): PointerActions {
    return {
      disabled: () => this.options.disabled,
      placeCaret: (caret, extend, by) =>
        this.apply(
          by === "char"
            ? moveCaret(this.editState, caret, extend)
            : extendTo(this.editState, caret.offset, by),
        ),
      selectWord: (offset) => this.apply(selectWord(this.editState, offset)),
      selectParagraph: (offset) => this.apply(selectParagraph(this.editState, offset)),
      grabHandle: (edge) => this.apply(grabHandle(this.editState, edge)),
      showHandles: (show) => this.applyScreen(showHandles(this.screen, show)),
      focus: () => this.input.focus(),
    };
  }

  // ---- 動いたあとの後始末 ----

  private limits(): Limits {
    return {
      editable: !this.options.readOnly && !this.options.disabled,
      maxLength: this.options.maxLength,
    };
  }

  /**
   * 動いた state を差し替えて、画面に出して、外へ知らせる。
   * **state が変わる場所はここだけ。**
   *
   * onChange を呼ぶかは、setValue だけが約束を違える (既定では呼ばない)
   */
  private apply(result: Result, announce = true): void {
    if (!result.changed) return;
    this.editState = result.state;
    // 画面に入れるかは操作が決めている。こちらは運ぶだけ
    this.sync(result.scrollIntoView);
    if (result.changed === "edit" && announce) this.callbacks.onChange?.(this.editState.text);
    if (result.changed !== "view") this.callbacks.onSelectionChange?.(selection(this.editState));
  }

  /** 画面の状態が動いた。外へは知らせないので、描き直すだけ */
  private applyScreen(next: ScreenState): void {
    if (next === this.screen) return;
    this.screen = next;
    this.redraw();
  }

  // ---- 受け口 ----

  private handleInsert(text: string): void {
    this.hideHandles();
    this.apply(this.ops.insertText(text));
  }

  /** 割り当ての無いキーも来る。打ったらハンドルを引っ込めるため */
  private handleKeyDown(command: Command | null): void {
    this.hideHandles();
    if (!command || this.options.disabled) return;
    this.apply(runCommand(this.editState, command, this.backend, this.limits()));
  }

  private handleFocus(): void {
    this.screen = setFocused(this.screen, true);
    this.sync();
    this.callbacks.onFocus?.();
  }

  private handleBlur(): void {
    this.screen = setFocused(this.screen, false);
    this.pointer.cancelDrag();
    // 打ちかけのまとまりを切る。本文も選択も動かないので apply は通さない
    this.editState = breakCoalescing(this.editState);
    this.sync();
    this.callbacks.onBlur?.();
  }

  /** 打ったらハンドルを引っ込める。描き直しは続く apply に任せる */
  private hideHandles(): void {
    this.screen = showHandles(this.screen, false);
  }

  // ---- 表示 ----

  private viewState(): ViewState {
    return buildViewState(viewContent(this.editState), this.screen, this.options.placeholder);
  }

  /** 本文や選択が動いた。描き直して、頼まれていればキャレットを見える位置に置いてもらう */
  private sync(scrollIntoView = false): void {
    if (this.destroyed) return;
    this.backend.show(this.viewState(), scrollIntoView);
    this.input.followCaret();
  }

  /** 点滅だけの描き直し。スクロールは動かさない */
  private redraw(): void {
    if (this.destroyed) return;
    this.backend.update(this.viewState());
  }
}
