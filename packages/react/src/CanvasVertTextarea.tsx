import {
  type CanvasVertTextareaOptions,
  CanvasVertTextarea as CoreEditor,
  type Selection,
} from "canvas-vert-textarea";
import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** core の描画設定のうち、DOM 側の関心ごとを除いたもの */
type StyleOptions = Omit<
  CanvasVertTextareaOptions,
  "value" | "onChange" | "onSelectionChange" | "onFocus" | "onBlur"
>;

export interface CanvasVertTextareaProps extends StyleOptions {
  /** 渡すと controlled になる */
  value?: string;
  defaultValue?: string;
  className?: string;
  style?: CSSProperties;
  onChange?: (value: string) => void;
  onSelectionChange?: (selection: Selection) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export interface CanvasVertTextareaHandle {
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

const fillStyle: CSSProperties = { width: "100%", height: "100%" };

export const CanvasVertTextarea = forwardRef<CanvasVertTextareaHandle, CanvasVertTextareaProps>(
  function CanvasVertTextarea(props, ref) {
    const { value, defaultValue, className, style, ...options } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<CoreEditor | null>(null);
    // イベントハンドラが変わるたびにエディタを作り直したくない
    const propsRef = useRef(props);
    propsRef.current = props;

    // 中身が同じなら setOptions を呼ばない。描画設定はどれも素の値
    const optionsKey = JSON.stringify(sortedKeys(options));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const { value: initial, defaultValue: fallback, ...rest } = propsRef.current;
      const editor = new CoreEditor(container, {
        ...omitDomProps(rest),
        value: initial ?? fallback ?? "",
        onChange: (next) => propsRef.current.onChange?.(next),
        onSelectionChange: (selection) => propsRef.current.onSelectionChange?.(selection),
        onFocus: () => propsRef.current.onFocus?.(),
        onBlur: () => propsRef.current.onBlur?.(),
      });
      editorRef.current = editor;

      return () => {
        editor.destroy();
        editorRef.current = null;
      };
    }, []);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || value === undefined) return;
      if (editor.value !== value) editor.setValue(value);
    }, [value]);

    useEffect(() => {
      editorRef.current?.setOptions(JSON.parse(optionsKey) as StyleOptions);
    }, [optionsKey]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        blur: () => editorRef.current?.blur(),
        insertText: (text: string) => editorRef.current?.insertText(text),
        selectAll: () => editorRef.current?.selectAll(),
        setSelection: (anchor: number, focus?: number) =>
          editorRef.current?.setSelection(anchor, focus),
        undo: () => editorRef.current?.undo(),
        redo: () => editorRef.current?.redo(),
        get editor() {
          return editorRef.current;
        },
      }),
      [],
    );

    return <div ref={containerRef} className={className} style={{ ...fillStyle, ...style }} />;
  },
);

function omitDomProps(props: Record<string, unknown>): StyleOptions {
  const { className: _c, style: _s, ...rest } = props;
  return rest as StyleOptions;
}

/** JSON.stringify はキーの順で結果が変わるので揃える */
function sortedKeys(options: StyleOptions): Record<string, unknown> {
  const source = options as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (typeof source[key] === "function") continue;
    result[key] = source[key];
  }
  return result;
}
