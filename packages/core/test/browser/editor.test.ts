import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasTextarea } from "../../src/backend/canvas/index";
import { DomTextarea } from "../../src/backend/dom/index";
import type { Textarea } from "../../src/textarea";
import type { TextareaOptions, WritingMode } from "../../src/types";

type Ctor = new (container: HTMLElement, options?: TextareaOptions) => Textarea;

// 2 つのバックエンド × 縦横。キー操作は論理なので、どれでも同じ振る舞いになる
const backends: [name: string, ctor: Ctor, writingMode: WritingMode][] = [
  ["canvas 縦書き", CanvasTextarea, "vertical-rl"],
  ["dom 縦書き", DomTextarea, "vertical-rl"],
  ["canvas 横書き", CanvasTextarea, "horizontal-tb"],
  ["dom 横書き", DomTextarea, "horizontal-tb"],
];

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

let Editor: Ctor = CanvasTextarea;
let writingMode: WritingMode = "vertical-rl";

/** 縦書きは字が下へ並び、行が左へ重なる。同じ操作でも押すキーが変わる */
function arrows() {
  return writingMode === "vertical-rl"
    ? { nextChar: "ArrowDown", prevChar: "ArrowUp", nextLine: "ArrowLeft", prevLine: "ArrowRight" }
    : { nextChar: "ArrowRight", prevChar: "ArrowLeft", nextLine: "ArrowDown", prevLine: "ArrowUp" };
}

function setup(options: TextareaOptions = {}) {
  const container = document.createElement("div");
  Object.assign(container.style, { width: "300px", height: "200px" });
  document.body.appendChild(container);

  const editor = new Editor(container, {
    writingMode,
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

describe.each(backends)("%s", (_name, ctor, mode) => {
  // describe の本体は収集時に走るので、実行時に切り替える
  beforeEach(() => {
    Editor = ctor;
    writingMode = mode;
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

    it("Enter の直後は次の行の頭にキャレットが来る", () => {
      const { editor, textarea } = setup({ value: "あい" });
      editor.setSelection(2);
      const before = editor.caretRect;

      key(textarea, "Enter");
      const after = editor.caretRect;

      // 次の行へ移り、行の中では頭に戻る。縦書きなら次の行は左、横書きなら下
      if (writingMode === "vertical-rl") {
        expect(after.x).toBeLessThan(before.x);
        expect(after.y).toBeLessThan(before.y);
      } else {
        expect(after.y).toBeGreaterThan(before.y);
        expect(after.x).toBeLessThan(before.x);
      }
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
    // 矢印は画面で見た向きのまま。縦書きなら字送りが ↑↓ で、行送りが ←→ になる
    it("字送りは 1 文字ずつ動く", () => {
      const { nextChar, prevChar } = arrows();
      const { editor, textarea } = setup({ value: "あいう" });
      editor.setSelection(0);
      key(textarea, nextChar);
      expect(editor.selection.focus).toBe(1);
      key(textarea, prevChar);
      expect(editor.selection.focus).toBe(0);
    });

    it("行送りは行を移る", () => {
      const { nextLine, prevLine } = arrows();
      const { editor, textarea } = setup({ value: "あ".repeat(400) });
      editor.setSelection(0);
      key(textarea, nextLine);

      // 何文字目で折り返すかは実フォントの送り次第。
      // canvas 版は全角を 1em と決め打つが、dom 版はフォントの縦送りに従う
      const landed = editor.selection.focus;
      expect(landed).toBeGreaterThan(0);
      expect(landed).toBeLessThan(400);

      key(textarea, prevLine);
      expect(editor.selection.focus).toBe(0);
    });

    it("選んでいるときの字送りは選んだ端に畳む", () => {
      const { nextChar, prevChar } = arrows();
      const { editor, textarea } = setup({ value: "あいうえお" });
      editor.setSelection(1, 3);
      key(textarea, prevChar);
      expect(editor.selection).toEqual({ anchor: 1, focus: 1 });

      editor.setSelection(1, 3);
      key(textarea, nextChar);
      expect(editor.selection).toEqual({ anchor: 3, focus: 3 });

      // 逆向きに選んでいても、着くのは選んだ端
      editor.setSelection(3, 1);
      key(textarea, nextChar);
      expect(editor.selection).toEqual({ anchor: 3, focus: 3 });
    });

    it("端で止まった字送りは行を移るときの狙いを消さない", () => {
      const { nextLine, prevLine, prevChar } = arrows();
      const { editor, textarea } = setup({ value: "あいう\nかきく" });
      editor.setSelection(1);
      key(textarea, prevLine);
      expect(editor.selection.focus).toBe(0);

      // 文頭では動けない。ここで狙いを捨てると、次の行送りが行頭に落ちてしまう
      key(textarea, prevChar);
      key(textarea, nextLine);
      expect(editor.selection.focus).toBe(5);
    });

    it("折り返しの境目に着いたキャレットは次の行の先頭に居る", () => {
      const { nextChar, nextLine, prevLine } = arrows();
      const { editor, textarea } = setup({ value: `あ\n${"あ".repeat(400)}` });
      // 何文字目で折り返すかはフォント次第なので、行送りで境目を探す
      editor.setSelection(2);
      key(textarea, nextLine);
      const wrap = editor.selection.focus;
      expect(wrap).toBeGreaterThan(2);

      editor.setSelection(wrap - 1);
      key(textarea, nextChar);
      expect(editor.selection.focus).toBe(wrap);

      // 前の行の末尾に居ると、短い 1 行目まで落ちて 1 になってしまう
      key(textarea, prevLine);
      expect(editor.selection.focus).toBe(2);
    });

    it("器が縮んでもキャレットを見失わない", async () => {
      // スマホでキーボードが出ると器が縮む。縦書きなら行の長さごと変わって全部組み直る
      const { container, editor } = setup({ value: "あ".repeat(400) });
      editor.focus();
      editor.setSelection(400);

      container.style.height = "80px";
      // ResizeObserver は次のフレームで来る
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const caret = editor.caretRect;
      expect(caret.x).toBeGreaterThanOrEqual(0);
      expect(caret.x + caret.width).toBeLessThanOrEqual(container.clientWidth);
      expect(caret.y).toBeGreaterThanOrEqual(0);
      expect(caret.y + caret.height).toBeLessThanOrEqual(container.clientHeight);
    });

    it("Shift を足すと選択が伸びる", () => {
      const { nextChar } = arrows();
      const { editor, textarea } = setup({ value: "あいう" });
      editor.setSelection(0);
      key(textarea, nextChar, { shiftKey: true });
      key(textarea, nextChar, { shiftKey: true });
      expect(editor.selection).toEqual({ anchor: 0, focus: 2 });
    });

    it("修飾キー付きの行送りで文頭と文末へ飛ぶ", () => {
      const { nextLine, prevLine } = arrows();
      const { editor, textarea } = setup({ value: "あいう" });
      editor.setSelection(1);
      key(textarea, nextLine, { metaKey: true });
      expect(editor.selection.focus).toBe(3);
      key(textarea, prevLine, { metaKey: true });
      expect(editor.selection.focus).toBe(0);
    });

    it("Option 付きの行送りで段落の端へ飛ぶ", () => {
      const { nextLine, prevLine } = arrows();
      const { editor, textarea } = setup({ value: "あい\nうえお\nかき" });
      editor.setSelection(4);
      key(textarea, prevLine, { altKey: true });
      expect(editor.selection.focus).toBe(3);
      // 段落の頭に居るときは、その段落の末まで
      key(textarea, nextLine, { altKey: true });
      expect(editor.selection.focus).toBe(6);
    });

    it("画面に入っていない行へも移れる", () => {
      // dom 側は当たり判定を描画に頼っていたので、隠れた行へ移れず文末へ飛んでいた
      const { editor, textarea } = setup({ value: "あ".repeat(400) });
      editor.setSelection(0);
      key(textarea, "PageDown");

      const focus = editor.selection.focus;
      expect(focus).toBeGreaterThan(0);
      expect(focus).toBeLessThan(400);
    });

    it("行送りを繰り返しても文末へ飛ばない", () => {
      const { nextLine } = arrows();
      const { editor, textarea } = setup({ value: "あ".repeat(400) });
      editor.setSelection(0);

      const seen: number[] = [];
      for (let i = 0; i < 8; i++) {
        key(textarea, nextLine);
        seen.push(editor.selection.focus);
      }

      // 行ごとに進むだけ。順番も崩れない
      expect(seen).toEqual([...seen].sort((a, b) => a - b));
      expect(seen[seen.length - 1]).toBeLessThan(400);
    });

    it("改行だけの本文でも行頭へ戻れる", () => {
      // 改行の矩形は潰れているので、行の中を引くときに読み飛ばしてしまっていた
      const { prevLine } = arrows();
      const { editor, textarea } = setup({ value: "\n" });
      editor.setSelection(1);
      key(textarea, prevLine);
      key(textarea, "Home");
      expect(editor.selection.focus).toBe(0);
    });

    it.each(["", "\n", "\n\n\n", "あい\n", "\nあい", "あ"])(
      "%j でもキャレットが本文の外へ出ない",
      (value) => {
        const { editor, textarea } = setup({ value });
        editor.setSelection(value.length);

        for (const name of [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ]) {
          key(textarea, name);
          expect(editor.selection.focus).toBeGreaterThanOrEqual(0);
          expect(editor.selection.focus).toBeLessThanOrEqual(value.length);
        }
      },
    );

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

  describe("ポインタ", () => {
    // WebKit は pointerdown の preventDefault では合成マウスイベントを止めない。
    // touchend の後に届く mousedown に既定動作を許すと、focus が surface に移って
    // hidden input から焦点が落ちる (iOS でタップしてもキャレットが出なくなる)
    it("あとから届く mousedown にフォーカスを奪わせない", () => {
      const { container, editor, textarea } = setup({ value: "吾輩は猫である。" });
      const surface = container.firstElementChild as HTMLElement;

      editor.focus();
      expect(document.activeElement).toBe(textarea);

      const mousedown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      surface.dispatchEvent(mousedown);

      expect(mousedown.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(textarea);
    });
  });
});

// 描画の中身を見たいものは dom バックエンドで覗く。
// 判断しているのは共通の Textarea なので、片方で確かめれば足りる
describe("描画", () => {
  function mount(options: TextareaOptions = {}) {
    const container = document.createElement("div");
    Object.assign(container.style, { width: "300px", height: "200px" });
    document.body.appendChild(container);
    const editor = new DomTextarea(container, {
      writingMode: "vertical-rl",
      font: { size: 20, lineHeight: 1.8 },
      padding: 10,
      caretBlinkInterval: 0,
      ...options,
    });
    cleanups.push(() => {
      editor.destroy();
      container.remove();
    });
    return { container, editor };
  }

  const painted = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

  it("範囲選択の間はキャレットを出さない", async () => {
    const { container, editor } = mount({ value: "あいうえお" });
    editor.focus();
    editor.setSelection(1);
    await painted();
    expect(container.querySelector("[data-caret]")).not.toBeNull();

    editor.setSelection(1, 4);
    await painted();
    expect(container.querySelector("[data-caret]")).toBeNull();

    editor.setSelection(4);
    await painted();
    expect(container.querySelector("[data-caret]")).not.toBeNull();
  });

  it("フォーカスが無ければキャレットを出さない", async () => {
    const { container, editor } = mount({ value: "あいうえお" });
    editor.setSelection(1);
    await painted();
    expect(container.querySelector("[data-caret]")).toBeNull();
  });
});
