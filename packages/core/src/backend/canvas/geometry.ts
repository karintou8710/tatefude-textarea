import type { Padding, WritingMode } from "../../types";
import type { Layout, LayoutLine } from "./layout";

export interface Geometry {
  writingMode: WritingMode;
  /** CSS px */
  width: number;
  height: number;
  padding: Padding;
  /** 行のピッチ */
  lineHeight: number;
  /** 全角 1 文字の送り量 */
  em: number;
  /** 行送り (block) 方向に送った量 */
  scroll: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 字の並ぶ向きを inline、行の重なる向きを block と呼ぶ。
 * 縦書きは inline が下向き・block が左向き、横書きは inline が右向き・block が下向き。
 * 座標の話はここに閉じ込めて、レイアウトと移動は軸を知らずに済ませる。
 */
export function isVertical(geo: Geometry): boolean {
  return geo.writingMode === "vertical-rl";
}

/** 1 行に入れられる長さ (inline 方向) */
export function contentLength(geo: Geometry): number {
  const { padding } = geo;
  const length = isVertical(geo)
    ? geo.height - padding.top - padding.bottom
    : geo.width - padding.left - padding.right;
  return Math.max(geo.em, length);
}

/** 行送り方向に見えている幅 (block 方向) */
export function contentBreadth(geo: Geometry): number {
  const { padding } = geo;
  const breadth = isVertical(geo)
    ? geo.width - padding.left - padding.right
    : geo.height - padding.top - padding.bottom;
  return Math.max(0, breadth);
}

/** 全部の行を並べたときに要る長さ (block 方向) */
export function totalBreadth(layout: Layout, geo: Geometry): number {
  return layout.lines.length * geo.lineHeight;
}

/** block 方向の、行の頭からの距離 (送りぶんを引いたもの) */
function blockAt(geo: Geometry, index: number): number {
  return geo.lineHeight * index - geo.scroll;
}

/** 論理座標 (行番号, 行の中の位置) → 物理座標 */
export function toPhysical(geo: Geometry, index: number, inline: number): { x: number; y: number } {
  const block = blockAt(geo, index);
  if (isVertical(geo)) {
    return { x: geo.width - geo.padding.right - block, y: geo.padding.top + inline };
  }
  return { x: geo.padding.left + inline, y: geo.padding.top + block };
}

/** 物理座標 → 論理座標 */
export function toLogical(geo: Geometry, x: number, y: number): { block: number; inline: number } {
  if (isVertical(geo)) {
    return {
      block: geo.width - geo.padding.right - x + geo.scroll,
      inline: y - geo.padding.top,
    };
  }
  return { block: y - geo.padding.top + geo.scroll, inline: x - geo.padding.left };
}

/**
 * offset がどの視覚行にあるか。
 * 折り返しの境目は前後どちらの行でも同じ offset になるので、
 * preferEnd で前の行の末尾に寄せるか次の行の頭に寄せるかを決める。
 */
export function lineIndexOfOffset(layout: Layout, offset: number, preferEnd = false): number {
  const lines = layout.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (offset < line.end) return i;
    if (offset === line.end) {
      const next = lines[i + 1];
      if (!next || line.hardBreak || next.start !== offset) return i;
      return preferEnd ? i : i + 1;
    }
  }
  return Math.max(0, lines.length - 1);
}

/** 行の中での inline 方向の位置 (px) */
export function offsetInLine(line: LayoutLine, offset: number): number {
  if (offset <= line.start) return 0;
  for (const ch of line.chars) {
    // 書記素の途中を指していたら頭に寄せる
    if (offset < ch.end) return ch.offset;
  }
  return line.length;
}

/**
 * キャレットの矩形。Range の潰れた矩形と同じで、送り方向の厚みは持たない。
 * 行を横切る向きには行ボックス全体を占める。ネイティブの textarea がそうなっている
 * (Blink: caret_rect.cc の ComputeLocalCaretRect が行ボックスまで広げる)。
 */
export function caretGeometry(
  layout: Layout,
  geo: Geometry,
  offset: number,
  preferEnd = false,
): Rect {
  const index = lineIndexOfOffset(layout, offset, preferEnd);
  const line = layout.lines[index];
  const inline = line ? offsetInLine(line, offset) : 0;
  return lineSpanRect(geo, index, inline, 0);
}

/** 行ボックス全体を横切る、inline 方向に length の矩形 */
function lineSpanRect(geo: Geometry, index: number, inline: number, length: number): Rect {
  const { x, y } = toPhysical(geo, index, inline);
  if (isVertical(geo)) {
    // toPhysical は行の block 側の端を返す。縦書きなら列の右端
    return { x: x - geo.lineHeight, y, width: geo.lineHeight, height: length };
  }
  return { x, y, width: length, height: geo.lineHeight };
}

export function selectionRects(layout: Layout, geo: Geometry, from: number, to: number): Rect[] {
  if (from >= to) return [];
  const rects: Rect[] = [];
  /** 改行だけの行も塗られていることが分かるように出す長さ */
  const newlineStub = geo.em * 0.4;
  const vertical = isVertical(geo);

  for (const line of layout.lines) {
    const lineEnd = line.hardBreak ? line.end + 1 : line.end;
    const head = Math.max(from, line.start);
    const tail = Math.min(to, lineEnd);
    if (head >= tail) continue;

    const inline = offsetInLine(line, head);
    const inlineEnd = tail > line.end ? line.length + newlineStub : offsetInLine(line, tail);
    if (inlineEnd <= inline) continue;

    const { x, y } = toPhysical(geo, line.index, inline);
    const length = inlineEnd - inline;
    rects.push(
      vertical
        ? { x: x - geo.lineHeight, y, width: geo.lineHeight, height: length }
        : { x, y, width: length, height: geo.lineHeight },
    );
  }

  return rects;
}

export interface PointHit {
  offset: number;
  /** 当たった視覚行 */
  line: number;
}

/** canvas 上の座標から、いちばん近いキャレット位置を返す */
export function offsetFromPoint(layout: Layout, geo: Geometry, x: number, y: number): PointHit {
  if (layout.lines.length === 0) return { offset: 0, line: 0 };

  const { block, inline } = toLogical(geo, x, y);
  const index = clamp(Math.floor(block / geo.lineHeight), 0, layout.lines.length - 1);
  const line = layout.lines[index];
  return { offset: offsetAtLineDistance(line, inline), line: index };
}

/** 行の中の inline 方向の位置 (px) から、いちばん近いキャレット位置を返す */
export function offsetAtLineDistance(line: LayoutLine, distance: number): number {
  if (distance <= 0) return line.start;
  for (const ch of line.chars) {
    if (distance < ch.offset + ch.advance) {
      // 字の後ろ半分なら次の位置へ。ちょうど中点はブラウザに合わせて手前
      return distance <= ch.offset + ch.advance / 2 ? ch.start : ch.end;
    }
  }
  return line.end;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
