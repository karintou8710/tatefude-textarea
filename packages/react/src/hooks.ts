import {
  type Ref,
  type RefObject,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
} from "react";
import {
  type Textarea as CoreEditor,
  DomTextarea,
  type Selection,
  type TextareaOptions,
} from "tatefude-textarea";
import { coreOptions } from "./options";
import type { TextareaHandle, TextareaProps } from "./types";

/**
 * エディタの生成と破棄。マウントのときだけ作る。
 *
 * ハンドラを依存に入れると、呼ぶ側が毎描画で新しい関数を書くたびに作り直しになり、
 * テキストも選択も変換中の状態も落ちる。かといって依存から外すとマウント時の
 * ハンドラを掴んだままになる。useEffectEvent は「呼ばれた時点の最新を読む、
 * 参照は変わらない関数」を返すので、そのどちらでもなくなる。
 */
export function useEditor(containerRef: RefObject<HTMLDivElement | null>, props: TextareaProps) {
  const editorRef = useRef<CoreEditor | null>(null);

  // ラップするのはハンドラ 1 つずつ。まとめて包むと、中で作った無名関数が
  // 生成時の props を掴んでしまい、結局その時点で固まる
  const onChange = useEffectEvent((next: string) => props.onChange?.(next));
  const onSelectionChange = useEffectEvent((s: Selection) => props.onSelectionChange?.(s));
  const onFocus = useEffectEvent(() => props.onFocus?.());
  const onBlur = useEffectEvent(() => props.onBlur?.());
  const create = useEffectEvent((container: HTMLElement) => {
    return new DomTextarea(container, {
      ...coreOptions(props),
      value: props.value ?? props.defaultValue ?? "",
      onChange,
      onSelectionChange,
      onFocus,
      onBlur,
    });
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = create(container);
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [containerRef]);

  return editorRef;
}

/**
 * 見た目は CSS に置いたので、props が変わらなくても組み直しが要ることがある。
 * className を差し替えた、style を変えた、外のスタイルシートが変わった——
 * どれも React からは「再描画した」としか見えない。依存を書かずに毎回叩く。
 */
export function useRefreshOnRender(editorRef: RefObject<CoreEditor | null>): void {
  useEffect(() => {
    editorRef.current?.refresh();
  });
}

/** controlled のときだけ、外からの値を流し込む */
export function useSyncedValue(editorRef: RefObject<CoreEditor | null>, value: string | undefined) {
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === undefined || editor.value === value) return;
    editor.setValue(value);
  }, [editorRef, value]);
}

export function useSyncedOptions(
  editorRef: RefObject<CoreEditor | null>,
  options: TextareaOptions,
) {
  useEffect(() => {
    editorRef.current?.setOptions(options);
  }, [editorRef, options]);
}

export function useEditorHandle(
  ref: Ref<TextareaHandle> | undefined,
  editorRef: RefObject<CoreEditor | null>,
): void {
  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.focus(),
      blur: () => editorRef.current?.blur(),
      insertText: (text: string) => editorRef.current?.insertText(text),
      cut: () => editorRef.current?.cut() ?? "",
      selectAll: () => editorRef.current?.selectAll(),
      get selectedText() {
        return editorRef.current?.selectedText ?? "";
      },
      get selectionRect() {
        return editorRef.current?.selectionRect ?? null;
      },
      setSelection: (anchor: number, focus?: number) =>
        editorRef.current?.setSelection(anchor, focus),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
      get editor() {
        return editorRef.current;
      },
    }),
    [editorRef],
  );
}
