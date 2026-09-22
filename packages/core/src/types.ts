/** 縦書き (行が右から左へ) と、横書き (行が上から下へ) */
export type WritingMode = "vertical-rl" | "horizontal-tb";

export interface Theme {
  background: string;
  text: string;
  placeholder: string;
  caret: string;
  /** 選択範囲。DOM の focus を失うと selectionInactive に替わる */
  selection: string;
  selectionInactive: string;
  /** 変換中の文字に引く線 */
  composition: string;
  /** 変換中で、いま IME が対象にしている文節 */
  compositionActive: string;
}

export const defaultTheme: Theme = {
  background: "transparent",
  text: "#1a1a1a",
  placeholder: "#9a9a9a",
  caret: "#1a1a1a",
  selection: "#b4d5fe",
  selectionInactive: "#dcdcdc",
  composition: "#1a1a1a",
  compositionActive: "#2563eb",
};

/**
 * UTF-16 オフセットで持つ選択範囲。
 * anchor が掴んだ側、head が動く側。
 */
export interface Selection {
  readonly anchor: number;
  readonly head: number;
}

/** 外へ知らせる先。`TextareaOptions` に混ざって渡されるぶんだけ */
export type Callbacks = Pick<
  TextareaOptions,
  "onChange" | "onSelectionChange" | "onFocus" | "onBlur"
>;

/**
 * コールバックだけ取り出す。**渡されていないキーは入れない**
 * ——重ねたときに、前に渡されたものを消さないため。
 * 型で狭めるだけだと、本文ごと抱えたオブジェクトが残る
 */
export function callbacksOf(options: TextareaOptions): Callbacks {
  const picked: Callbacks = {};
  if ("onChange" in options) picked.onChange = options.onChange;
  if ("onSelectionChange" in options) picked.onSelectionChange = options.onSelectionChange;
  if ("onFocus" in options) picked.onFocus = options.onFocus;
  if ("onBlur" in options) picked.onBlur = options.onBlur;
  return picked;
}

export interface SetValueOptions {
  selection?: Selection;
  /** onChange を呼ぶか。既定では呼ばない */
  notify?: boolean;
  keepHistory?: boolean;
}

/**
 * 外から輪に入る口。
 *
 * ここに在るのは操作そのものではなく、**`edit/` の操作を `apply` に結び付けたもの**。
 * `undo()` は `apply(edit.undo(state))` で、操作を選ぶ役と適用する役の 2 つを繋いでいる。
 * 編集操作の本体は `edit/` にあって、あちらは `apply` を知らない。
 *
 * 受け口 (`input/`) から来る道と、ここから来る道は同じ `apply` に合流する。
 * だからツールバーのボタンとキーで挙動がずれない。
 * DOM の focus は本文を動かさないので、こちらには入れない。
 */
export interface TextareaCommands {
  setValue(value: string, options?: SetValueOptions): void;
  setSelection(anchor: number, head?: number): void;
  selectAll(): void;
  insertText(text: string): void;
  /** 選択を切り取って返す。自前のメニューやボタンから使う */
  cut(): string;
  undo(): void;
  redo(): void;
}

/**
 * 呼んだら何か動くか。ボタンの出し入れに使う。
 * 引数は `commands` と同じものを渡す。
 *
 * **「許されているか」ではなく「動くか」を返す。**
 * いまと同じ場所を指す `setSelection` は false になる。
 * 操作を実際に走らせて、状態が動くかだけを見ているため
 */
export type TextareaCan = {
  [K in keyof TextareaCommands]: (...args: Parameters<TextareaCommands[K]>) => boolean;
};

/**
 * いまの中身。読むだけの写しで、ここを触っても本文は動かない。
 * 動かすのは `setValue` などの操作の側。
 */
export interface TextareaState {
  readonly value: string;
  readonly selection: Selection;
  readonly selectedText: string;
  /** 変換中か。確定していない字を抱えている間は true */
  readonly composing: boolean;
}

/**
 * 寸法とレイアウトは CSS に置く。字の大きさ・行送り・余白・禁則は
 * container に当てたスタイルから読むので、ここには出てこない。
 *
 * 色だけは違う。canvas は ctx.fillStyle に値そのものを要るし、
 * 選択も変換中の下線も自前の要素なので ::selection も ::placeholder も効かない。
 * CSS 変数で受けると型が付かないので、ここで受ける。
 */
export interface TextareaOptions {
  value?: string;
  /**
   * 既定は縦書き。CSS の writing-mode と同じものだが、
   * 矢印がどちらへ動くかを決める振る舞いなので props で受ける。
   */
  writingMode?: WritingMode;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  maxLength?: number;
  /**
   * container に足すクラス。字の大きさ・余白・禁則をここから読ませる。
   * 元から付いているクラスは消さない。
   */
  className?: string;
  theme?: Partial<Theme>;
  /** キャレットの点滅間隔 (ms)。0 で点滅しない */
  caretBlinkInterval?: number;
  onChange?: (value: string) => void;
  onSelectionChange?: (selection: Selection) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export interface ResolvedOptions {
  writingMode: WritingMode;
  placeholder: string;
  readOnly: boolean;
  disabled: boolean;
  maxLength: number;
  className: string;
  theme: Theme;
  caretBlinkInterval: number;
}

export function resolveOptions(options: TextareaOptions): ResolvedOptions {
  return {
    writingMode: options.writingMode ?? "vertical-rl",
    placeholder: options.placeholder ?? "",
    readOnly: options.readOnly ?? false,
    disabled: options.disabled ?? false,
    maxLength: options.maxLength ?? Number.POSITIVE_INFINITY,
    className: options.className ?? "",
    theme: { ...defaultTheme, ...options.theme },
    caretBlinkInterval: options.caretBlinkInterval ?? 530,
  };
}
