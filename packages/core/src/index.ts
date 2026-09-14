export type {
  Backend,
  BackendFactory,
  CaretRect,
  CompositionRange,
  ViewState,
} from "./backend";
export { CanvasBackend } from "./canvas/backend";
export { CanvasTextarea } from "./canvas/index";
export type { Geometry, PointHit, Rect } from "./layout/geometry";
export {
  caretGeometry,
  contentBreadth,
  contentLength,
  isVertical,
  lineIndexOfOffset,
  offsetAtLineDistance,
  offsetFromPoint,
  offsetInLine,
  selectionRects,
  toLogical,
  toPhysical,
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
export type { SetValueOptions } from "./textarea";
export { Textarea } from "./textarea";
export type {
  FontStyle,
  Padding,
  ResolvedOptions,
  Selection,
  TextareaOptions,
  Theme,
  WritingMode,
} from "./types";
export { defaultFont, defaultTheme, resolveOptions } from "./types";
