export type {
  Backend,
  BackendFactory,
  CaretRect,
  CompositionRange,
  ViewState,
} from "./backend";
export { CanvasBackend } from "./canvas/backend";
export type { Orientation } from "./canvas/char-class";
export {
  isLatinWordChar,
  isLineEndForbidden,
  isLineStartForbidden,
  isSmallKana,
  orientationOf,
} from "./canvas/char-class";
export type { Geometry, PointHit, Rect } from "./canvas/geometry";
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
} from "./canvas/geometry";
export { CanvasTextarea } from "./canvas/index";
export type { Layout, LayoutLine, LayoutParams, PlacedChar } from "./canvas/layout";
export { layoutText } from "./canvas/layout";
export type { Measurer } from "./canvas/measure";
export { CanvasMeasurer, cssFont } from "./canvas/measure";
export { moveAcrossLines, movePage, moveToLineEdge } from "./canvas/movement";
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
