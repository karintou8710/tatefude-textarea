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
  type TextareaCan,
  type TextareaCommands,
  type TextareaOptions,
  type TextareaState,
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
 * 見た目は CSS に置いたので、props が変わらなくてもレイアウトが要ることがある。
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
    if (!editor || value === undefined || editor.state.value === value) return;
    editor.commands.setValue(value);
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

/** まだマウントしていない間の受け皿。触る側に null を配らないため */
const noopCommands: TextareaCommands = {
  setValue: () => {},
  setSelection: () => {},
  selectAll: () => {},
  insertText: () => {},
  cut: () => "",
  undo: () => {},
  redo: () => {},
};

/** まだマウントしていない間は何も動かせない */
const noopCan: TextareaCan = {
  setValue: () => false,
  setSelection: () => false,
  selectAll: () => false,
  insertText: () => false,
  cut: () => false,
  undo: () => false,
  redo: () => false,
};

/** まだマウントしていない間の写し。触る側に null を配らないため */
const emptyState: TextareaState = {
  value: "",
  selection: { anchor: 0, focus: 0 },
  selectedText: "",
  composing: false,
};

export function useEditorHandle(
  ref: Ref<TextareaHandle> | undefined,
  editorRef: RefObject<CoreEditor | null>,
): void {
  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.focus(),
      blur: () => editorRef.current?.blur(),
      get state() {
        return editorRef.current?.state ?? emptyState;
      },
      get commands() {
        return editorRef.current?.commands ?? noopCommands;
      },
      get can() {
        return editorRef.current?.can ?? noopCan;
      },
      get container() {
        return editorRef.current?.container ?? null;
      },
      get selectionRect() {
        return editorRef.current?.selectionRect ?? null;
      },
      get editor() {
        return editorRef.current;
      },
    }),
    [editorRef],
  );
}
