/**
 * 縦横の座標変換。
 *
 * レイアウトは inline (字の並ぶ向き) と block (行の重なる向き) で考え、
 * 物理の x/y へ直すのはここだけ。縦書きでは inline が下向き、
 * block が右から左へ進むので、両者の対応が入れ替わる。
 *
 * DOM に触らない。矩形は値として受け取るので、node のテストで回せる。
 */

/** DOMRect と CaretRect の両方が満たす最小の形。right / bottom は自分で出す */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * 向きと、測った寸法と、原点をひとまとめにしたもの。
 *
 * **1 回作って引き回す。**中の矩形は getBoundingClientRect で読むので、
 * 関数ごとに作り直すとレイアウトを何度も確定させることになる。
 */
export interface Axis {
  readonly vertical: boolean;
  /** 測った行送り (px) */
  readonly lineHeight: number;
  /** 字が入っている箱の、行を横切る向きの長さ (px)。キャレットの長さはこれ */
  readonly fontBox: number;
  /** 本文を載せた層 (クライアント座標) */
  readonly layer: Rect;
  /** スクロールコンテナ (クライアント座標) */
  readonly surface: Rect;
}

const right = (rect: Rect) => rect.x + rect.width;
const bottom = (rect: Rect) => rect.y + rect.height;

/** layer の block 始端からの距離 → クライアント座標 */
export function toClient(axis: Axis, block: number, inline: number): Point {
  const { layer } = axis;
  return axis.vertical
    ? { x: right(layer) - block, y: layer.y + inline }
    : { x: layer.x + inline, y: layer.y + block };
}

/** 矩形の中心が layer の block 始端からどれだけ離れているか */
export function blockOfRectInLayer(axis: Axis, rect: Rect): number {
  const { layer } = axis;
  return axis.vertical
    ? right(layer) - (rect.x + rect.width / 2)
    : rect.y + rect.height / 2 - layer.y;
}

/** 矩形が何行目に乗っているか */
export function lineOfRect(axis: Axis, rect: Rect): number {
  return lineAt(axis, blockOfRectInLayer(axis, rect));
}

/** 行の中で、字が始まる位置 */
export function inlineStartOf(axis: Axis, rect: Rect): number {
  return axis.vertical ? rect.y - axis.layer.y : rect.x - axis.layer.x;
}

/** 行の中で、字が終わる位置 */
export function inlineEndOf(axis: Axis, rect: Rect): number {
  return axis.vertical ? bottom(rect) - axis.layer.y : right(rect) - axis.layer.x;
}

/** 字がスクロール方向に占める長さ */
export function inlineSizeOf(axis: Axis, rect: Rect): number {
  return axis.vertical ? rect.height : rect.width;
}

/** 1 行に入る長さ */
export function layerLength(axis: Axis): number {
  return axis.vertical ? axis.layer.height : axis.layer.width;
}

/** surface 基準のキャレット矩形から block 方向の中心を取り出す。矩形は行ボックス全体 */
export function blockOfCaret(axis: Axis, rect: Rect): number {
  return axis.vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
}

export function inlineOfCaret(axis: Axis, rect: Rect): number {
  return axis.vertical ? rect.y : rect.x;
}

/** クライアント座標の点が、surface の block 方向のどこに落ちるか */
export function blockOfPoint(axis: Axis, clientX: number, clientY: number): number {
  return axis.vertical ? clientX - axis.surface.x : clientY - axis.surface.y;
}

/** surface 基準のキャレット矩形 → layer 基準の block 位置 */
export function blockOfCaretInLayer(axis: Axis, rect: Rect): number {
  const { layer, surface } = axis;
  return axis.vertical
    ? right(layer) - (surface.x + rect.x + rect.width / 2)
    : surface.y + rect.y + rect.height / 2 - layer.y;
}

/** surface 基準の inline 位置 → layer 基準 */
export function inlineInLayer(axis: Axis, distance: number): number {
  const { layer, surface } = axis;
  return axis.vertical ? surface.y + distance - layer.y : surface.x + distance - layer.x;
}

/** block 方向の距離 → 何行目か */
export function lineAt(axis: Axis, block: number): number {
  return Math.max(0, Math.floor(block / axis.lineHeight));
}
