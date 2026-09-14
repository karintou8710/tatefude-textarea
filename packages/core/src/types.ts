/** 今は縦書き・行が右から左へ進むものだけ */
export type WritingMode = "vertical-rl";

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FontStyle {
  family: string;
  /** px。全角 1 文字の送り量でもある */
  size: number;
  /** 行送り。size に対する倍率 */
  lineHeight: number;
  weight: string;
}

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

/**
 * UTF-16 オフセットで持つ選択範囲。
 * anchor が掴んだ側、focus が動く側。
 */
export interface Selection {
  anchor: number;
  focus: number;
}

export interface VertTextareaOptions {
  value?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  maxLength?: number;
  /** 縦書きの禁則処理をかけるか */
  kinsoku?: boolean;
  /**
   * 小書き仮名を右上にずらす量 (em)。
   * canvas からはフォントの vert テーブルが引けないので、本来フォントが持つ
   * 縦組み字形の代わりに平行移動で近似している。0 で切れる。
   */
  smallKanaShift?: number;
  font?: Partial<FontStyle>;
  padding?: number | Partial<Padding>;
  theme?: Partial<Theme>;
  /** キャレットの点滅間隔 (ms)。0 で点滅しない */
  caretBlinkInterval?: number;
  onChange?: (value: string) => void;
  onSelectionChange?: (selection: Selection) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export interface ResolvedOptions {
  placeholder: string;
  readOnly: boolean;
  disabled: boolean;
  maxLength: number;
  kinsoku: boolean;
  smallKanaShift: number;
  font: FontStyle;
  padding: Padding;
  theme: Theme;
  caretBlinkInterval: number;
}

export const defaultFont: FontStyle = {
  family: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
  size: 20,
  lineHeight: 1.8,
  weight: "400",
};

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

export function resolveOptions(options: VertTextareaOptions): ResolvedOptions {
  return {
    placeholder: options.placeholder ?? "",
    readOnly: options.readOnly ?? false,
    disabled: options.disabled ?? false,
    maxLength: options.maxLength ?? Number.POSITIVE_INFINITY,
    kinsoku: options.kinsoku ?? true,
    smallKanaShift: options.smallKanaShift ?? 0.08,
    font: { ...defaultFont, ...options.font },
    padding: resolvePadding(options.padding),
    theme: { ...defaultTheme, ...options.theme },
    caretBlinkInterval: options.caretBlinkInterval ?? 530,
  };
}

function resolvePadding(padding: VertTextareaOptions["padding"]): Padding {
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  const fallback = 16;
  return {
    top: padding?.top ?? fallback,
    right: padding?.right ?? fallback,
    bottom: padding?.bottom ?? fallback,
    left: padding?.left ?? fallback,
  };
}
