/** 縦書き (行が右から左へ) と、横書き (行が上から下へ) */
export type WritingMode = "vertical-rl" | "horizontal-tb";

export interface Theme {
  background: string;
  text: string;
  placeholder: string;
  caret: string;
  /** 選択範囲。フォーカスを失うと selectionInactive に替わる */
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
 * anchor が掴んだ側、focus が動く側。
 */
export interface Selection {
  anchor: number;
  focus: number;
}

/**
 * 寸法と組み方は CSS に置く。字の大きさ・行送り・余白・禁則は
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
