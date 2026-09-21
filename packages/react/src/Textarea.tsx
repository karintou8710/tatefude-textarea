import { type CSSProperties, useRef } from "react";
import {
  useEditor,
  useEditorHandle,
  useRefreshOnRender,
  useSyncedOptions,
  useSyncedValue,
} from "./hooks";
import { useStableOptions } from "./options";
import type { TextareaProps } from "./types";

const fillStyle: CSSProperties = { width: "100%", height: "100%" };

export function Textarea(props: TextareaProps) {
  const { value, className, style, ref } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useEditor(containerRef, props);

  useSyncedValue(editorRef, value);
  useSyncedOptions(editorRef, useStableOptions(props));
  useEditorHandle(ref, editorRef);
  // レイアウトは最後。値と設定を入れたあとの姿で読み直す
  useRefreshOnRender(editorRef);

  return <div ref={containerRef} className={className} style={{ ...fillStyle, ...style }} />;
}
