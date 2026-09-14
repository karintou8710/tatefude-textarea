import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasVertTextarea } from "../../src/canvas/index";
import { DomVertTextarea } from "../../src/dom/index";
import type { VertTextareaOptions } from "../../src/types";
import type { VertTextarea } from "../../src/vert-textarea";

type Ctor = new (container: HTMLElement, options?: VertTextareaOptions) => VertTextarea;

// 2 つのバックエンドは同じ API を持つ。振る舞いも同じであることをここで縛る
const backends: [name: string, ctor: Ctor][] = [
  ["canvas", CanvasVertTextarea],
  ["dom", DomVertTextarea],
];

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

let Editor: Ctor = CanvasVertTextarea;

function setup(options: VertTextareaOptions = {}) {
  const container = document.createElement("div");
  Object.assign(container.style, { width: "300px", height: "200px" });
  document.body.appendChild(container);

  const editor = new Editor(container, {
    font: { size: 20, lineHeight: 1.8 },
    padding: 10,
    caretBlinkInterval: 0,
    ...options,
  });
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("hidden textarea が無い");

  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  return { container, editor, textarea };
}

function type(textarea: HTMLTextAreaElement, text: string) {
  textarea.value = text;
  textarea.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
  );
}

function key(textarea: HTMLTextAreaElement, name: string, init: KeyboardEventInit = {}) {
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
  );
}

function compose(textarea: HTMLTextAreaElement, reading: string, committed: string) {
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  textarea.value = reading;
  textarea.setSelectionRange(reading.length, reading.length);
  textarea.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertCompositionText",
      data: reading,
      isComposing: true,
    }),
  );
  textarea.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true, data: committed }),
  );
}

/** 描画は rAF に乗るので 2 フレーム待つ */
function nextFrames() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

describe.each(backends)("%s バックエンド", (_name, ctor) => {
  // describe の本体は収集時に走るので、実行時に切り替える
  beforeEach(() => {
    Editor = ctor;
  });

  describe("文字を入れる", () => {
    it("打った文字が value に入る", () => {
      const { editor, textarea } = setup();
      type(textarea, "吾輩は猫");
      expect(editor.value).toBe("吾輩は猫");
      expect(editor.selection).toEqual({ anchor: 4, focus: 4 });
    });

    it("最初のキャレットは文頭に置く", () => {
      const { editor } = setup({ value: "あいう" });
      expect(editor.selection).toEqual({ anchor: 0, focus: 0 });
    });

    it("Enter で改行する", () => {
      const { editor, textarea } = setup({ value: "あ" });
      editor.setSelection(1);
      key(textarea, "Enter");
      type(textarea, "い");
      expect(editor.value).toBe("あ\nい");
    });

    it("Backspace で 1 文字消す", () => {
      const { editor, textarea } = setup({ value: "あい" });
      editor.setSelection(2);
      key(textarea, "Backspace");
      expect(editor.value).toBe("あ");
    });

    it("結合した絵文字はまとめて消える", () => {
      const { editor, textarea } = setup({ value: "a👨‍👩‍👦" });
      editor.setSelection(editor.value.length);
      key(textarea, "Backspace");
      expect(editor.value).toBe("a");
    });

    it("\\r\\n は \\n に均す", () => {
      const { editor, textarea } = setup();
      type(textarea, "あ\r\nい");
      expect(editor.value).toBe("あ\nい");
    });

    it("maxLength を超えるぶんは切る", () => {
      const { editor, textarea } = setup({ maxLength: 3 });
      type(textarea, "あいうえお");
      expect(editor.value).toBe("あいう");
    });

    it("readOnly では入らない", () => {
      const { editor, textarea } = setup({ value: "あ", readOnly: true });
      type(textarea, "い");
      key(textarea, "Backspace");
      expect(editor.value).toBe("あ");
    });

    it("onChange が変更後の値で呼ばれる", () => {
      const seen: string[] = [];
      const { textarea } = setup({ onChange: (value) => seen.push(value) });
      type(textarea, "あ");
      type(textarea, "い");
      expect(seen).toEqual(["あ", "あい"]);
    });
  });

  describe("IME", () => {
    it("変換を確定すると本文に入る", () => {
      const { editor, textarea } = setup({ value: "「" });
      editor.setSelection(1);
      compose(textarea, "にほんご", "日本語");
      expect(editor.value).toBe("「日本語");
      expect(editor.selection).toEqual({ anchor: 4, focus: 4 });
    });

    it("変換中は本文がまだ変わらない", () => {
      const { editor, textarea } = setup();
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      textarea.value = "にほんご";
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          data: "にほんご",
        }),
      );
      expect(editor.value).toBe("");
    });

    it("選択したまま変換を始めると選択が消える", () => {
      const { editor, textarea } = setup({ value: "あいう" });
      editor.setSelection(0, 3);
      compose(textarea, "ねこ", "猫");
      expect(editor.value).toBe("猫");
    });

    it("変換を取り消しても本文は変わらない", () => {
      const { editor, textarea } = setup({ value: "あ" });
      compose(textarea, "にほんご", "");
      expect(editor.value).toBe("あ");
    });
  });

  describe("キャレットの移動", () => {
    it("上下は行の中を動く", () => {
      const { editor, textarea } = setup({ value: "あいう" });
      editor.setSelection(0);
      key(textarea, "ArrowDown");
      expect(editor.selection.focus).toBe(1);
      key(textarea, "ArrowUp");
      expect(editor.selection.focus).toBe(0);
    });

    it("左右は行を移る", () => {
      // 行長 180px / 20px = 9 文字で折り返す
      const { editor, textarea } = setup({ value: "あ".repeat(20) });
      editor.setSelection(0);
      key(textarea, "ArrowLeft");
      expect(editor.selection.focus).toBe(9);
      key(textarea, "ArrowRight");
      expect(editor.selection.focus).toBe(0);
    });

    it("Shift を足すと選択が伸びる", () => {
      const { editor, textarea } = setup({ value: "あいう" });
      editor.setSelection(0);
      key(textarea, "ArrowDown", { shiftKey: true });
      key(textarea, "ArrowDown", { shiftKey: true });
      expect(editor.selection).toEqual({ anchor: 0, focus: 2 });
    });

    it("修飾キー付きの左右で文頭と文末へ飛ぶ", () => {
      const { editor, textarea } = setup({ value: "あいう" });
      editor.setSelection(1);
      key(textarea, "ArrowLeft", { metaKey: true });
      expect(editor.selection.focus).toBe(3);
      key(textarea, "ArrowRight", { metaKey: true });
      expect(editor.selection.focus).toBe(0);
    });

    it("全選択できる", () => {
      const { editor, textarea } = setup({ value: "あいう" });
      key(textarea, "a", { metaKey: true });
      expect(editor.selection).toEqual({ anchor: 0, focus: 3 });
    });
  });

  describe("undo と redo", () => {
    it("打った文字をまとめて戻す", () => {
      const { editor, textarea } = setup();
      type(textarea, "あ");
      type(textarea, "い");
      editor.undo();
      expect(editor.value).toBe("");
      editor.redo();
      expect(editor.value).toBe("あい");
    });

    it("キャレットを動かすと戻す単位が切れる", () => {
      const { editor, textarea } = setup();
      type(textarea, "あ");
      editor.setSelection(0);
      type(textarea, "い");
      editor.undo();
      expect(editor.value).toBe("あ");
    });
  });

  describe("外から触る", () => {
    it("setValue は onChange を呼ばない", () => {
      const seen: string[] = [];
      const { editor } = setup({ onChange: (value) => seen.push(value) });
      editor.setValue("あい");
      expect(editor.value).toBe("あい");
      expect(seen).toEqual([]);
    });

    it("setValue は選択を文字数に収める", () => {
      const { editor } = setup({ value: "あいうえお" });
      editor.setSelection(4, 5);
      editor.setValue("あ");
      expect(editor.selection).toEqual({ anchor: 1, focus: 1 });
    });

    it("destroy で中身が消える", () => {
      const { container, editor } = setup();
      editor.destroy();
      expect(container.querySelector("textarea")).toBeNull();
      expect(container.children.length).toBe(0);
    });
  });

  describe("描画", () => {
    it("本文も変換中も選択も描ける", async () => {
      const { editor, textarea } = setup({ value: "吾輩は猫である。\n名前はまだ無い。" });
      editor.focus();
      editor.setSelection(0, 5);
      await nextFrames();

      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      textarea.value = "なまえ";
      textarea.setSelectionRange(1, 3);
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          data: "なまえ",
        }),
      );
      await nextFrames();

      expect(editor.lineCount).toBeGreaterThan(0);
    });

    it("空なら placeholder を組む", async () => {
      const { editor } = setup({ placeholder: "ここに書く" });
      await nextFrames();
      expect(editor.value).toBe("");
      expect(editor.lineCount).toBe(1);
    });
  });
});
