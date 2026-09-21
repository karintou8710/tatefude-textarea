// 公開するのは「使う」ためのものだけ。出すと消せなくなる。
//
// **内側の縫い目は出さない。**`Backend` / `Input` / `Pointer` / `TextareaInit` は
// 差し替えられる口だが、差し替えるのはテストだけ。テストは `src/` を直に import するので、
// `index.ts` に出す理由が無い。出すと「誰も渡さない引数」を永久に約束することになる。
// 別のレイアウトを足すのもこのリポジトリの中の仕事——canvas がそうなっている。
//
// 寸法とレイアウト (font, padding, 禁則) は CSS に置いたので、ここには型が無い。
// 色だけは Theme として出す。canvas が値で要り、選択も下線も自前の要素なので。

export { DomTextarea } from "./dom";
export type { CaretRect } from "./layout";
/** 型だけ。組むのは `DomTextarea` から */
export type { Textarea } from "./textarea";
export type {
  Selection,
  SetValueOptions,
  TextareaCan,
  TextareaCommands,
  TextareaOptions,
  TextareaState,
  Theme,
  WritingMode,
} from "./types";
export { defaultTheme } from "./types";
