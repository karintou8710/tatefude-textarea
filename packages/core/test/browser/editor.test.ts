import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasTextarea } from "../../src/backend/canvas/index";
import type { CanvasStyleOptions } from "../../src/backend/canvas/style";
import { DomTextarea } from "../../src/backend/dom/index";
import type { Textarea } from "../../src/textarea";
import type { TextareaOptions, WritingMode } from "../../src/types";
import { applyStyle, canvasStyle, type TestStyle } from "./style";

type Ctor = new (
  container: HTMLElement,
  options?: TextareaOptions,
  style?: CanvasStyleOptions,
) => Textarea;

const STYLE = { size: 20, lineHeight: 1.8, padding: 10 };

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

function setup(options: TextareaOptions = {}, style: TestStyle = STYLE) {
  const container = document.createElement("div");
  Object.assign(container.style, { width: "300px", height: "200px" });
  applyStyle(container, style);
  document.body.appendChild(container);

  const editor = new Editor(
    container,
    { writingMode, caretBlinkInterval: 0, ...options },
    canvasStyle(style),
  );
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("hidden textarea が無い");

  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  return { container, editor, textarea };
}

function pointer(
  container: HTMLElement,
  kind: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: PointerEventInit = {},
) {
  const surface = container.firstElementChild as HTMLElement;
  surface.dispatchEvent(
    new PointerEvent(kind, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      isPrimary: true,
      pointerType: "touch",
      ...init,
    }),
  );
}

/** container の真ん中あたり */
function middle(container: HTMLElement) {
  const box = container.getBoundingClientRect();
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
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

    it.runIf(ctor === DomTextarea)("ブラウザが行送りを丸めても本文からずれない", () => {
      // Safari は line-height の端数を整数に丸める (17 x 1.8 = 30.6 → 30)。
      // 行送りを決め打つと、行番号に比例してキャレットが字から離れていく
      const { container, editor } = setup(
        { value: "あ".repeat(400) },
        { size: 17, lineHeight: 1.8, padding: 10, family: "serif" },
      );
      const layer = (container.firstElementChild as HTMLElement).children[1] as HTMLElement;
      const content = [...layer.children].find((el) =>
        el.textContent?.startsWith("あ"),
      ) as HTMLElement;
      // 丸めるエンジンと同じ状況を作って、組み直させる
      content.style.setProperty("line-height", "30px", "important");
      editor.setValue(`${"あ".repeat(400)}い`);

      // 遠い行で、字とキャレットを比べる
      const node = content.firstChild as Text;
      const offset = 200;
      editor.setSelection(offset);

      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const glyph = range.getBoundingClientRect();
      const surface = (container.firstElementChild as HTMLElement).getBoundingClientRect();
      const caret = editor.caretRect;

      // 行を横切る軸で比べる。縦書きなら x、横書きなら y
      const vertical = mode === "vertical-rl";
      const glyphCenter = vertical ? glyph.x + glyph.width / 2 : glyph.y + glyph.height / 2;
      const caretCenter = vertical
        ? surface.x + caret.x + caret.width / 2
        : surface.y + caret.y + caret.height / 2;
      expect(Math.abs(caretCenter - glyphCenter)).toBeLessThan(1);
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

  describe("指で触る", () => {
    it("なぞっただけならキーボードを開かない", () => {
      const { container, textarea } = setup({ value: "あ".repeat(400) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      // 指を置いただけでは、叩いたのかスクロールなのかまだ決まらない
      expect(document.activeElement).not.toBe(textarea);

      pointer(container, "pointermove", { clientX: at.clientX - 60, clientY: at.clientY });
      pointer(container, "pointerup", { clientX: at.clientX - 60, clientY: at.clientY });
      expect(document.activeElement).not.toBe(textarea);
    });

    it("軽く叩いたらそこにキャレットが来る", () => {
      const { container, editor, textarea } = setup({ value: "あ".repeat(400) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      expect(document.activeElement).toBe(textarea);
      expect(editor.selection.focus).toBeGreaterThan(0);
    });

    it("ブラウザがスクロールを取ったら叩いた扱いにしない", () => {
      const { container, textarea } = setup({ value: "あ".repeat(400) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      // パンを始めたブラウザは pointercancel を投げてくる
      pointer(container, "pointercancel", at);
      pointer(container, "pointerup", at);
      expect(document.activeElement).not.toBe(textarea);
    });

    it("マウスは押した時点で掴む", () => {
      const { container, editor, textarea } = setup({ value: "あ".repeat(400) });
      const at = middle(container);

      pointer(container, "pointerdown", { ...at, pointerType: "mouse" });
      expect(document.activeElement).toBe(textarea);
      expect(editor.selection.focus).toBeGreaterThan(0);
    });

    it("叩いた場所は器が縮んでも動かない", async () => {
      // キーボードは何段階かに分けて出てくる。組み直るたびに、突いた行は画面の同じところに残す
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      // 先頭からずらしておく。送りが 0 のままだと戻す先が合っていなくても気づけない
      editor.setSelection(600);
      await nextFrames();

      const at = middle(container);
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      const blockOfCaret = () => {
        const rect = editor.caretRect;
        return vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      };
      const before = blockOfCaret();

      for (const size of ["160px", "120px"]) {
        if (vertical) container.style.height = size;
        else container.style.width = size;
        await nextFrames();
      }

      expect(Math.abs(blockOfCaret() - before)).toBeLessThan(1);
    });

    it("なぞってから叩いても、指の下にキャレットが来る", async () => {
      // 焦点の無いところを叩くと、焦点を入れた時点で「古いキャレットを見せる」送りが入る。
      // なぞって古いキャレットを画面の外へ出しておくと、それに引きずられて別の列に着く
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      editor.focus();
      editor.setSelection(200);
      await nextFrames();
      // キーボードを閉じた直後と同じ状態にして、指でなぞる
      editor.blur();
      editor.scrollOffset += 1500;
      await nextFrames();

      const box = container.getBoundingClientRect();
      const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      // 指が乗っている行にキャレットが来る。ズレは行の中心までの半行ぶんに収まる
      const rect = editor.caretRect;
      const center = vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      const finger = vertical ? at.clientX - box.left : at.clientY - box.top;
      expect(Math.abs(center - finger)).toBeLessThan(36 / 2 + 1);
    });

    it("選択の外接矩形が取れる", () => {
      // 自前のメニューを選択の脇に出すのに要る
      const { editor } = setup({ value: "吾輩は猫である。名前はまだ無い。".repeat(10) });
      expect(editor.selectionRect).toBeNull();

      editor.setSelection(10, 30);
      const rect = editor.selectionRect;
      if (!rect) throw new Error("選択しているのに矩形が無い");
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);

      // 両端のキャレットを含む
      editor.setSelection(10);
      const head = editor.caretRect;
      editor.setSelection(30);
      const tail = editor.caretRect;
      for (const point of [head, tail]) {
        expect(point.x).toBeGreaterThanOrEqual(rect.x - 1);
        expect(point.x + point.width).toBeLessThanOrEqual(rect.x + rect.width + 1);
        expect(point.y).toBeGreaterThanOrEqual(rect.y - 1);
        expect(point.y + point.height).toBeLessThanOrEqual(rect.y + rect.height + 1);
      }
    });

    it("長押しでキャレットを置き、そのまま引きずって動かせる", async () => {
      // iOS の編集可能なテキストと同じ割り当て。単語選択はダブルタップ側に持たせる
      const { container, editor, textarea } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(document.activeElement).toBe(textarea);
      const placed = editor.selection;
      expect(placed.anchor).toBe(placed.focus);

      // 掴んだままなぞると、キャレットが付いてくる (選択は伸びない)
      pointer(container, "pointermove", {
        clientX: at.clientX + 40,
        clientY: at.clientY + 40,
      });
      pointer(container, "pointerup", { clientX: at.clientX + 40, clientY: at.clientY + 40 });
      const moved = editor.selection;
      expect(moved.anchor).toBe(moved.focus);
      expect(moved.focus).not.toBe(placed.focus);
    });

    it("なぞっている間は長押しにならない", async () => {
      const { container, editor, textarea } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);
      const moved = { clientX: at.clientX - 40, clientY: at.clientY - 40 };

      pointer(container, "pointerdown", at);
      pointer(container, "pointermove", moved);
      await new Promise((resolve) => setTimeout(resolve, 600));
      pointer(container, "pointerup", moved);

      // なぞっただけ。キーボードも出さないし、キャレットも動かさない
      expect(document.activeElement).not.toBe(textarea);
      expect(editor.selection).toEqual({ anchor: 0, focus: 0 });
    });

    it("続けて 2 回叩くと単語、3 回で段落を選ぶ", () => {
      // 合成マウスイベントは止めてあるので、ダブルクリックの detail は当てにできない
      const { container, editor } = setup({ value: "吾輩は猫である。\nここで段落が変わる。" });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      expect(editor.selection.anchor).toBe(editor.selection.focus);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      const word = editor.selection;
      expect(Math.abs(word.focus - word.anchor)).toBeGreaterThan(0);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      const paragraph = editor.selection;
      expect(Math.abs(paragraph.focus - paragraph.anchor)).toBeGreaterThan(
        Math.abs(word.focus - word.anchor),
      );
    });

    it("単語を選んだまま引きずると伸びる", () => {
      const { container, editor } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      pointer(container, "pointerdown", at);
      const word = editor.selection;

      pointer(container, "pointermove", { clientX: at.clientX + 50, clientY: at.clientY + 50 });
      pointer(container, "pointerup", { clientX: at.clientX + 50, clientY: at.clientY + 50 });

      const grown = editor.selection;
      expect(grown.anchor).toBe(word.anchor);
      expect(Math.abs(grown.focus - grown.anchor)).toBeGreaterThan(
        Math.abs(word.focus - word.anchor),
      );
    });

    it.runIf(ctor === DomTextarea)("つまみは選択の両端に出る", async () => {
      const { container, editor } = setup({ value: "吾輩は猫である。名前はまだ無い。".repeat(10) });
      const vertical = writingMode === "vertical-rl";
      const at = middle(container);

      // キャレットだけのときは出さない (iOS と同じ。丸が出るのは選択の端だけ)
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      await nextFrames();
      expect(container.querySelectorAll("[data-handle]")).toHaveLength(0);

      // 続けて叩いて単語を選ぶと、両端に 1 つずつ
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      await nextFrames();
      const dots = [...container.querySelectorAll("[data-handle]")] as HTMLElement[];
      expect(dots.map((el) => el.dataset.handle)).toEqual(["start", "end"]);

      // 丸は棒から行送り方向の外側へ、半径ぶん押し出したところ
      const { anchor, focus } = editor.selection;
      const [from, to] = anchor <= focus ? [anchor, focus] : [focus, anchor];
      const box = container.getBoundingClientRect();
      const centerOf = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2 - box.x, y: r.y + r.height / 2 - box.y };
      };
      const radius = 6;
      // 測る前に控える。選択を畳むとつまみは消えてしまう
      const [startDot, endDot] = [centerOf(dots[0]), centerOf(dots[1])];

      editor.setSelection(from);
      await nextFrames();
      const head = editor.caretRect;
      expect(startDot).toEqual(
        vertical
          ? { x: head.x + head.width + radius, y: head.y }
          : { x: head.x, y: head.y - radius },
      );

      editor.setSelection(to);
      await nextFrames();
      const tail = editor.caretRect;
      expect(endDot).toEqual(
        vertical
          ? { x: tail.x - radius, y: tail.y }
          : { x: tail.x, y: tail.y + tail.height + radius },
      );
    });

    it.runIf(ctor === DomTextarea)("選択の端のつまみを引くと、その端だけ動く", async () => {
      // つまみは指の作法なので dom 経路だけが持つ
      const { container, editor } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      await nextFrames();
      const word = editor.selection;

      const handle = container.querySelector('[data-handle="end"]') as HTMLElement | null;
      if (!handle) throw new Error("つまみが描かれていない");
      const box = handle.getBoundingClientRect();
      const from = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
      const to = { clientX: from.clientX + 30, clientY: from.clientY + 30 };

      pointer(container, "pointerdown", from);
      pointer(container, "pointermove", to);
      pointer(container, "pointerup", to);

      // 掴んでいない側 (anchor) は動かない
      const grown = editor.selection;
      expect(grown.anchor).toBe(word.anchor);
      expect(grown.focus).not.toBe(word.focus);
    });

    it("器が縮んだら、隠し入力も中へ置き直す", async () => {
      // iOS はキーボードの下に取り残された入力を見つけると、開いた直後に閉じてしまう
      const { container, editor, textarea } = setup({ value: "あ".repeat(2000) });
      editor.focus();
      editor.setSelection(600);
      await nextFrames();

      // キーボードが出てくる側 (下端) の近くを叩く
      const box = container.getBoundingClientRect();
      const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height - 20 };
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      container.style.height = "120px";
      await nextFrames();

      const input = textarea.getBoundingClientRect();
      const host = container.getBoundingClientRect();
      const left = input.x - host.x;
      const top = input.y - host.y;
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(container.clientHeight - 1);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(container.clientWidth - 1);
    });

    it("キーボードを閉じた時も、列は動かない", async () => {
      // 開く時と同じで、閉じる時も器が変わって全部組み直る。
      // 焦点が外れたあとなので、戻す先を持っていないと読んでいた場所ごと飛ぶ
      const { container, editor, textarea } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      const blockOfCaret = () => {
        const rect = editor.caretRect;
        return vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      };

      editor.focus();
      editor.setSelection(600);
      await nextFrames();
      const at = middle(container);
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      // キーボードが出て、そこで書く
      if (vertical) container.style.height = "120px";
      else container.style.width = "200px";
      await nextFrames();
      type(textarea, "あ");
      await nextFrames();
      const before = blockOfCaret();

      // 閉じる。焦点が外れてから器が戻る
      editor.blur();
      if (vertical) container.style.height = "200px";
      else container.style.width = "300px";
      await nextFrames();

      expect(Math.abs(blockOfCaret() - before)).toBeLessThan(1);
    });

    it("潰れる側を叩いても、キャレットは画面に残る", async () => {
      // 器は行送り方向にも潰れる。潰れた側を叩いていると、戻す先がそのまま画面の外になる
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      editor.setSelection(600);
      await nextFrames();

      // 器が減る側 (縦書きなら右端、横書きなら下端) の近くを叩く
      const box = container.getBoundingClientRect();
      const at = vertical
        ? { clientX: box.left + box.width - 20, clientY: box.top + box.height / 2 }
        : { clientX: box.left + box.width / 2, clientY: box.top + box.height - 20 };
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      if (vertical) container.style.width = "150px";
      else container.style.height = "120px";
      await nextFrames();

      const rect = editor.caretRect;
      expect(vertical ? rect.x : rect.y).toBeGreaterThanOrEqual(0);
      expect(vertical ? rect.x + rect.width : rect.y + rect.height).toBeLessThanOrEqual(
        vertical ? container.clientWidth : container.clientHeight,
      );
    });

    it.each([
      ["ホイールで送ったら", "wheel"],
      ["指でなぞったら", "pan"],
    ])("%s、叩いた場所には戻さない", async (_name, how) => {
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      editor.setSelection(600);
      await nextFrames();

      const at = middle(container);
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      // 自分で送った先が見たい位置。キャレットは画面の外へ出る
      if (how === "wheel") {
        const surface = container.firstElementChild as HTMLElement;
        surface.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 2000 }),
        );
      } else {
        // 指のパンはブラウザが送る。こちらに届くのは「叩かなかった」ことだけ。
        // 叩いた場所から始めると、続けて叩いた扱い (単語を掴んで伸ばす) になる
        const from = { clientX: at.clientX + 50, clientY: at.clientY + 50 };
        pointer(container, "pointerdown", from);
        pointer(container, "pointermove", {
          clientX: from.clientX - 80,
          clientY: from.clientY - 80,
        });
        pointer(container, "pointerup", { clientX: from.clientX - 80, clientY: from.clientY - 80 });
        editor.scrollOffset += 2000;
      }

      if (vertical) container.style.height = "120px";
      else container.style.width = "200px";
      await nextFrames();

      // 戻す約束は解けている。見えるところまで送るだけなので、キャレットは器の端の行に着く。
      // 端に寄せるのは行ボックス (36px) なので、キャレットの中心は余白から半行ぶん内側
      const rect = editor.caretRect;
      const center = vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      const size = vertical ? container.clientWidth : container.clientHeight;
      const edge = 10 + 36 / 2;
      expect(Math.min(Math.abs(center - edge), Math.abs(size - edge - center))).toBeLessThan(1);
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
    applyStyle(container, STYLE);
    document.body.appendChild(container);
    const editor = new DomTextarea(container, {
      writingMode: "vertical-rl",
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
