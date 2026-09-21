export type {
  Backend,
  BackendFactory,
  CaretRect,
  CompositionRange,
  ViewState,
} from "./backend/backend";
export { CanvasBackend } from "./backend/canvas/backend";
export type { Orientation } from "./backend/canvas/char-class";
export {
  isLatinWordChar,
  isLineEndForbidden,
  isLineStartForbidden,
  isSmallKana,
  orientationOf,
} from "./backend/canvas/char-class";
export type { Geometry, PointHit, Rect } from "./backend/canvas/geometry";
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
} from "./backend/canvas/geometry";
export { CanvasTextarea } from "./backend/canvas/index";
export type { Layout, LayoutLine, LayoutParams, PlacedChar } from "./backend/canvas/layout";
export { layoutText } from "./backend/canvas/layout";
export type { Measurer } from "./backend/canvas/measure";
export { CanvasMeasurer, cssFont } from "./backend/canvas/measure";
export { moveAcrossLines, movePage, moveToLineEdge } from "./backend/canvas/movement";
export type { Caret, Goal } from "./model/movement";
export { moveInline } from "./model/movement";
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
