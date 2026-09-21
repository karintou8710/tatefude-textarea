import type { CSSProperties, Ref } from "react";
import type {
  CaretRect,
  Textarea as CoreEditor,
  Selection,
  TextareaCan,
  TextareaCommands,
  TextareaOptions,
  TextareaState,
} from "tatefude-textarea";

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
  /** いまの中身。読むだけの写し */
  readonly state: TextareaState;
  /** 編集の操作。本文と選択を動かすものは全部ここから */
  readonly commands: TextareaCommands;
  /** その操作がいま何か動かすか。ボタンの出し入れに使う */
  readonly can: TextareaCan;
  /** 選択の外接矩形。container 基準。選択が無ければ null */
  readonly selectionRect: CaretRect | null;
  /** エディタを置いた要素。矩形を画面の座標に直すのに要る */
  readonly container: HTMLElement | null;
  /** 逃げ道。core のインスタンスをそのまま触りたいとき */
  readonly editor: CoreEditor | null;
}
