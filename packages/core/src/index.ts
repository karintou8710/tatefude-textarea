export type { SetValueOptions } from "./editor";
export { CanvasVertTextarea } from "./editor";
export type { CaretGeometry, Geometry, PointHit, Rect } from "./layout/geometry";
export {
  caretGeometry,
  contentBreadth,
  contentLength,
  lineCenterX,
  lineIndexOfOffset,
  offsetAtLineDistance,
  offsetFromPoint,
  offsetInLine,
  selectionRects,
  totalBreadth,
} from "./layout/geometry";

export type { Layout, LayoutLine, LayoutParams, PlacedChar } from "./layout/layout";
export { layoutText } from "./layout/layout";
export type { Measurer } from "./layout/measure";
export { CanvasMeasurer, cssFont } from "./layout/measure";
export type { Caret, Goal } from "./model/movement";
export { moveAcrossLines, moveInline, movePage, moveToLineEdge } from "./model/movement";

export type { Orientation } from "./text/char-class";
export {
  isLatinWordChar,
  isLineEndForbidden,
  isLineStartForbidden,
  isSmallKana,
  orientationOf,
} from "./text/char-class";
export type { Grapheme } from "./text/segment";
export { segmentGraphemes, stepGrapheme, stepWord } from "./text/segment";
export type {
  CanvasVertTextareaOptions,
  FontStyle,
  Padding,
  ResolvedOptions,
  Selection,
  Theme,
  WritingMode,
} from "./types";
export { defaultFont, defaultTheme, resolveOptions } from "./types";
