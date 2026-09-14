import type { CSSProperties, Ref } from "react";
import type { Textarea as CoreEditor, Selection, TextareaOptions } from "tatefude-textarea";

/** core の設定のうち、DOM 側の関心ごとを除いたもの */
type StyleOptions = Omit<
  TextareaOptions,
  "value" | "onChange" | "onSelectionChange" | "onFocus" | "onBlur"
>;

export interface TextareaProps extends StyleOptions {
  ref?: Ref<TextareaHandle>;
  /** 渡すと controlled になる */
  value?: string;
  defaultValue?: string;
  /** container の div に付く。core の className と同じ役目で、こちらは JSX が持つ */
  className?: string;
  style?: CSSProperties;
  onChange?: (value: string) => void;
  onSelectionChange?: (selection: Selection) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export interface TextareaHandle {
  focus(): void;
  blur(): void;
  insertText(text: string): void;
  selectAll(): void;
  setSelection(anchor: number, focus?: number): void;
  undo(): void;
  redo(): void;
  /** 逃げ道。core のインスタンスをそのまま触りたいとき */
  readonly editor: CoreEditor | null;
}
