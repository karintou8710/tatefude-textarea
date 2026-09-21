/**
 * 縦横の座標変換。
 *
 * 組みは inline (字の並ぶ向き) と block (行の重なる向き) で考え、
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

const right = (rect: Rect) => rect.x + rect.width;
const bottom = (rect: Rect) => rect.y + rect.height;

/** layer の block 始端からの距離 → クライアント座標 */
export function toClient(vertical: boolean, block: number, inline: number, layer: Rect): Point {
  return vertical
    ? { x: right(layer) - block, y: layer.y + inline }
    : { x: layer.x + inline, y: layer.y + block };
}

/** 矩形の中心が layer の block 始端からどれだけ離れているか */
export function blockOfRectInLayer(vertical: boolean, rect: Rect, layer: Rect): number {
  return vertical ? right(layer) - (rect.x + rect.width / 2) : rect.y + rect.height / 2 - layer.y;
}

/** 行の中で、字が始まる位置 */
export function inlineStartOf(vertical: boolean, rect: Rect, layer: Rect): number {
  return vertical ? rect.y - layer.y : rect.x - layer.x;
}

/** 行の中で、字が終わる位置 */
export function inlineEndOf(vertical: boolean, rect: Rect, layer: Rect): number {
  return vertical ? bottom(rect) - layer.y : right(rect) - layer.x;
}

/** 字が送り方向に占める長さ */
export function inlineSizeOf(vertical: boolean, rect: Rect): number {
  return vertical ? rect.height : rect.width;
}

/** 1 行に入る長さ */
export function layerLength(vertical: boolean, layer: Rect): number {
  return vertical ? layer.height : layer.width;
}

/** surface 基準のキャレット矩形から block 方向の中心を取り出す。矩形は行ボックス全体 */
export function blockOfCaret(vertical: boolean, rect: Rect): number {
  return vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
}

export function inlineOfCaret(vertical: boolean, rect: Rect): number {
  return vertical ? rect.y : rect.x;
}

/** surface 基準のキャレット矩形 → layer 基準の block 位置 */
export function blockOfCaretInLayer(
  vertical: boolean,
  rect: Rect,
  layer: Rect,
  surface: Rect,
): number {
  return vertical
    ? right(layer) - (surface.x + rect.x + rect.width / 2)
    : surface.y + rect.y + rect.height / 2 - layer.y;
}

/** surface 基準の inline 位置 → layer 基準 */
export function inlineInLayer(
  vertical: boolean,
  distance: number,
  layer: Rect,
  surface: Rect,
): number {
  return vertical ? surface.y + distance - layer.y : surface.x + distance - layer.x;
}

/** block 方向の距離 → 何行目か。行送りは測った値を渡す */
export function lineAt(lineHeight: number, block: number): number {
  return Math.max(0, Math.floor(block / lineHeight));
}
