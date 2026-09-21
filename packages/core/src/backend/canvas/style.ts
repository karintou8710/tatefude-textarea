/**
 * canvas 経路だけの見た目の指定。
 *
 * dom 側は font も padding も色も CSS から読むので、こういう型を持たない。
 * canvas は字を 1 つずつ置く都合で色と寸法を数値で要るが、
 * その要求を公開 API に出すと dom だけの利用者にも背負わせることになる。
 * 生成時に決めて、あとは動かさない。
 */

export interface FontStyle {
  family: string;
  /** px。全角 1 文字の送り量でもある */
  size: number;
  /** 行送り。size に対する倍率 */
  lineHeight: number;
  weight: string;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CanvasStyle {
  font: FontStyle;
  padding: Padding;
  /** 縦書きの禁則処理をかけるか */
  kinsoku: boolean;
  /**
   * 小書き仮名を右上にずらす量 (em)。
   * canvas からはフォントの vert テーブルが引けないので、本来フォントが持つ
   * 縦組み字形の代わりに平行移動で近似している。0 で切れる。
   */
  smallKanaShift: number;
}

export interface CanvasStyleOptions {
  font?: Partial<FontStyle>;
  padding?: number | Partial<Padding>;
  kinsoku?: boolean;
  smallKanaShift?: number;
}

export const defaultFont: FontStyle = {
  family: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
  size: 20,
  lineHeight: 1.8,
  weight: "400",
};

export function resolveCanvasStyle(style: CanvasStyleOptions = {}): CanvasStyle {
  return {
    font: { ...defaultFont, ...style.font },
    padding: resolvePadding(style.padding),
    kinsoku: style.kinsoku ?? true,
    smallKanaShift: style.smallKanaShift ?? 0.08,
  };
}

function resolvePadding(padding: CanvasStyleOptions["padding"]): Padding {
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
