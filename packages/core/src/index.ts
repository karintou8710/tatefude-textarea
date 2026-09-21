// 公開するのは「使う」ためのものと、「別の組み方を足す」ためのものだけ。
// 組み方の中身は実装詳細なので出さない。canvas はまだ外に見せない。
// 出すと消せなくなる。
//
// 寸法と組み方 (font, padding, 禁則) は CSS に置いたので、ここには型が無い。
// 色だけは Theme として出す。canvas が値で要り、選択も下線も自前の要素なので。

export type {
  Backend,
  BackendFactory,
  CaretRect,
  CompositionRange,
  ViewState,
} from "./backend/backend";
export { DomBackend } from "./backend/dom/backend";
export { DomTextarea } from "./backend/dom/index";
export type { Caret, Goal } from "./model/movement";
export type { SetValueOptions } from "./textarea";
export { Textarea } from "./textarea";
export type { ResolvedOptions, Selection, TextareaOptions, Theme, WritingMode } from "./types";
export { defaultTheme, resolveOptions } from "./types";
