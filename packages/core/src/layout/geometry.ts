import type { Padding } from "../types";
import type { Layout, LayoutLine } from "./layout";

export interface Geometry {
  /** CSS px */
  width: number;
  height: number;
  padding: Padding;
  /** 列のピッチ */
  lineHeight: number;
  /** 全角 1 文字の送り量 */
  em: number;
  /** 行送り方向 (左) へ送った量。0 なら 1 行目が右端に来る */
  scroll: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaretGeometry {
  line: number;
  /** 列の中心 */
  x: number;
  /** 送り方向の位置 */
  y: number;
  /** キャレットの長さ (列を横切る向き) */
  size: number;
}

/** 1 行に入れられる長さ */
export function contentLength(geo: Geometry): number {
  return Math.max(geo.em, geo.height - geo.padding.top - geo.padding.bottom);
}

/** 行送り方向に見えている幅 */
export function contentBreadth(geo: Geometry): number {
  return Math.max(0, geo.width - geo.padding.left - geo.padding.right);
}

export function lineCenterX(geo: Geometry, index: number): number {
  return geo.width - geo.padding.right - geo.lineHeight * (index + 0.5) + geo.scroll;
}

export function lineStartY(geo: Geometry): number {
  return geo.padding.top;
}

/** 全部の行を並べたときに要る幅 */
export function totalBreadth(layout: Layout, geo: Geometry): number {
  return layout.lines.length * geo.lineHeight;
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

/** 行の中での送り方向の位置 (px) */
export function offsetInLine(line: LayoutLine, offset: number): number {
  if (offset <= line.start) return 0;
  for (const ch of line.chars) {
    // 書記素の途中を指していたら頭に寄せる
    if (offset < ch.end) return ch.offset;
  }
  return line.length;
}

export function caretGeometry(
  layout: Layout,
  geo: Geometry,
  offset: number,
  preferEnd = false,
): CaretGeometry {
  const index = lineIndexOfOffset(layout, offset, preferEnd);
  const line = layout.lines[index];
  const y = line ? offsetInLine(line, offset) : 0;
  return {
    line: index,
    x: lineCenterX(geo, index),
    y: lineStartY(geo) + y,
    size: geo.em,
  };
}

export function selectionRects(layout: Layout, geo: Geometry, from: number, to: number): Rect[] {
  if (from >= to) return [];
  const rects: Rect[] = [];
  /** 改行だけの行も塗られていることが分かるように出す長さ */
  const newlineStub = geo.em * 0.4;

  for (const line of layout.lines) {
    const lineEnd = line.hardBreak ? line.end + 1 : line.end;
    const head = Math.max(from, line.start);
    const tail = Math.min(to, lineEnd);
    if (head >= tail) continue;

    const y = offsetInLine(line, head);
    const yEnd = tail > line.end ? line.length + newlineStub : offsetInLine(line, tail);
    if (yEnd <= y) continue;

    rects.push({
      x: lineCenterX(geo, line.index) - geo.lineHeight / 2,
      y: lineStartY(geo) + y,
      width: geo.lineHeight,
      height: yEnd - y,
    });
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

  const right = geo.width - geo.padding.right + geo.scroll;
  const index = clamp(Math.floor((right - x) / geo.lineHeight), 0, layout.lines.length - 1);
  const line = layout.lines[index];

  const local = y - lineStartY(geo);
  if (local <= 0) return { offset: line.start, line: index };

  for (const ch of line.chars) {
    if (local < ch.offset + ch.advance) {
      // 字の後ろ半分なら次の位置へ
      const offset = local < ch.offset + ch.advance / 2 ? ch.start : ch.end;
      return { offset, line: index };
    }
  }
  return { offset: line.end, line: index };
}

/** 行の中の送り方向の位置 (px) から、いちばん近いキャレット位置を返す */
export function offsetAtLineDistance(line: LayoutLine, distance: number): number {
  if (distance <= 0) return line.start;
  for (const ch of line.chars) {
    if (distance < ch.offset + ch.advance) {
      return distance < ch.offset + ch.advance / 2 ? ch.start : ch.end;
    }
  }
  return line.end;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
