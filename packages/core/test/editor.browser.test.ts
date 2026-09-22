import { userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CanvasStyleOptions } from "../src/backend/canvas/style";
import { CanvasTextarea } from "../src/canvas";
import { DomTextarea } from "../src/dom";
import type { Textarea } from "../src/textarea";
import type { TextareaOptions, WritingMode } from "../src/types";
import { byUnit, toDocEdge } from "./keys";
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
/** 値が 2 フレーム続けて変わらなくなるまで待つ */
async function settled(read: () => number, limit = 2000) {
  const started = performance.now();
  let last = Number.NaN;
  let stable = 0;
  while (performance.now() - started < limit) {
    await nextFrames();
    const now = read();
    stable = now === last ? stable + 1 : 0;
    last = now;
    if (stable >= 2) return;
  }
  throw new Error(`落ち着かないまま ${limit}ms 過ぎた`);
}

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
      expect(editor.state.value).toBe("吾輩は猫");
      expect(editor.state.selection).toEqual({ anchor: 4, head: 4 });
    });

    it("最初のキャレットは文頭に置く", () => {
      const { editor } = setup({ value: "あいう" });
      expect(editor.state.selection).toEqual({ anchor: 0, head: 0 });
    });

    it("Enter の直後は次の行の頭にキャレットが来る", () => {
      const { editor, textarea } = setup({ value: "あい" });
      editor.commands.setSelection(2);
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
      editor.commands.setSelection(1);
      key(textarea, "Enter");
      type(textarea, "い");
      expect(editor.state.value).toBe("あ\nい");
    });

    it("Backspace で 1 文字消す", () => {
      const { editor, textarea } = setup({ value: "あい" });
      editor.commands.setSelection(2);
      key(textarea, "Backspace");
      expect(editor.state.value).toBe("あ");
    });

    it("結合した絵文字はまとめて消える", () => {
      const { editor, textarea } = setup({ value: "a👨‍👩‍👦" });
      editor.commands.setSelection(editor.state.value.length);
      key(textarea, "Backspace");
      expect(editor.state.value).toBe("a");
    });

    it("\\r\\n は \\n に均す", () => {
      const { editor, textarea } = setup();
      type(textarea, "あ\r\nい");
      expect(editor.state.value).toBe("あ\nい");
    });

    it("maxLength を超えるぶんは切る", () => {
      const { editor, textarea } = setup({ maxLength: 3 });
      type(textarea, "あいうえお");
      expect(editor.state.value).toBe("あいう");
    });

    it("readOnly では入らない", () => {
      const { editor, textarea } = setup({ value: "あ", readOnly: true });
      type(textarea, "い");
      key(textarea, "Backspace");
      expect(editor.state.value).toBe("あ");
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
      editor.commands.setSelection(1);
      compose(textarea, "にほんご", "日本語");
      expect(editor.state.value).toBe("「日本語");
      expect(editor.state.selection).toEqual({ anchor: 4, head: 4 });
    });

    it("変換中の字も本文に入り、composing で見分ける", () => {
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
      expect(editor.state.value).toBe("にほんご");
      expect(editor.state.composing).toBe(true);
      // キャレットは文節の末尾。確定していないことは composing で分かる
      expect(editor.state.selection).toEqual({ anchor: 4, head: 4 });
    });

    it("選択したまま変換を始めると選択が消える", () => {
      const { editor, textarea } = setup({ value: "あいう" });
      editor.commands.setSelection(0, 3);
      compose(textarea, "ねこ", "猫");
      expect(editor.state.value).toBe("猫");
    });

    it("変換を取り消しても本文は変わらない", () => {
      const { editor, textarea } = setup({ value: "あ" });
      compose(textarea, "にほんご", "");
      expect(editor.state.value).toBe("あ");
    });
  });

  describe("キャレットの移動", () => {
    // 矢印は画面で見た向きのまま。縦書きならインライン方向が ↑↓ で、ブロック方向が ←→ になる
    it("インライン方向は 1 文字ずつ動く", () => {
      const { nextChar, prevChar } = arrows();
      const { editor, textarea } = setup({ value: "あいう" });
      editor.commands.setSelection(0);
      key(textarea, nextChar);
      expect(editor.state.selection.head).toBe(1);
      key(textarea, prevChar);
      expect(editor.state.selection.head).toBe(0);
    });

    it("ブロック方向は行を移る", () => {
      const { nextLine, prevLine } = arrows();
      const { editor, textarea } = setup({ value: "あ".repeat(400) });
      editor.commands.setSelection(0);
      key(textarea, nextLine);

      // 何文字目で折り返すかは実フォントの送り次第。
      // canvas 版は全角を 1em と決め打つが、dom 版はフォントの縦送りに従う
      const landed = editor.state.selection.head;
      expect(landed).toBeGreaterThan(0);
      expect(landed).toBeLessThan(400);

      key(textarea, prevLine);
      expect(editor.state.selection.head).toBe(0);
    });

    it("選んでいるときのインライン方向は選んだ端に畳む", () => {
      const { nextChar, prevChar } = arrows();
      const { editor, textarea } = setup({ value: "あいうえお" });
      editor.commands.setSelection(1, 3);
      key(textarea, prevChar);
      expect(editor.state.selection).toEqual({ anchor: 1, head: 1 });

      editor.commands.setSelection(1, 3);
      key(textarea, nextChar);
      expect(editor.state.selection).toEqual({ anchor: 3, head: 3 });

      // 逆向きに選んでいても、着くのは選んだ端
      editor.commands.setSelection(3, 1);
      key(textarea, nextChar);
      expect(editor.state.selection).toEqual({ anchor: 3, head: 3 });
    });

    it("端で止まったインライン方向は行を移るときの狙いを消さない", () => {
      const { nextLine, prevLine, prevChar } = arrows();
      const { editor, textarea } = setup({ value: "あいう\nかきく" });
      editor.commands.setSelection(1);
      key(textarea, prevLine);
      expect(editor.state.selection.head).toBe(0);

      // 文頭では動けない。ここで狙いを捨てると、次のブロック方向の移動が行頭に落ちてしまう
      key(textarea, prevChar);
      key(textarea, nextLine);
      expect(editor.state.selection.head).toBe(5);
    });

    it("折り返しの境目に着いたキャレットは次の行の先頭に居る", () => {
      const { nextChar, nextLine, prevLine } = arrows();
      const { editor, textarea } = setup({ value: `あ\n${"あ".repeat(400)}` });
      // 何文字目で折り返すかはフォント次第なので、ブロック方向の移動で境目を探す
      editor.commands.setSelection(2);
      key(textarea, nextLine);
      const wrap = editor.state.selection.head;
      expect(wrap).toBeGreaterThan(2);

      editor.commands.setSelection(wrap - 1);
      key(textarea, nextChar);
      expect(editor.state.selection.head).toBe(wrap);

      // 前の行の末尾に居ると、短い 1 行目まで落ちて 1 になってしまう
      key(textarea, prevLine);
      expect(editor.state.selection.head).toBe(2);
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
      editor.commands.setValue(`${"あ".repeat(400)}い`);

      // 遠い行で、字とキャレットを比べる
      const node = content.firstChild as Text;
      const offset = 200;
      editor.commands.setSelection(offset);

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

    it("コンテナが縮んでもキャレットを見失わない", async () => {
      // スマホでキーボードが出るとコンテナが縮む。縦書きなら行の長さごと変わって全部組み直る
      const { container, editor } = setup({ value: "あ".repeat(400) });
      editor.focus();
      editor.commands.setSelection(400);

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
      editor.commands.setSelection(0);
      key(textarea, nextChar, { shiftKey: true });
      key(textarea, nextChar, { shiftKey: true });
      expect(editor.state.selection).toEqual({ anchor: 0, head: 2 });
    });

    it("文頭と文末へ飛ぶ", () => {
      const lines = arrows();
      const { editor, textarea } = setup({ value: "あいう" });
      editor.commands.setSelection(1);
      key(textarea, ...toDocEdge("end", lines));
      expect(editor.state.selection.head).toBe(3);
      key(textarea, ...toDocEdge("start", lines));
      expect(editor.state.selection.head).toBe(0);
    });

    it("ブロック方向に語の修飾を足すと段落の端へ飛ぶ", () => {
      const { nextLine, prevLine } = arrows();
      const { editor, textarea } = setup({ value: "あい\nうえお\nかき" });
      editor.commands.setSelection(4);
      key(textarea, prevLine, byUnit);
      expect(editor.state.selection.head).toBe(3);
      // 段落の頭に居るときは、その段落の末まで
      key(textarea, nextLine, byUnit);
      expect(editor.state.selection.head).toBe(6);
    });

    it("画面に入っていない行へも移れる", () => {
      // dom 側は当たり判定を描画に頼っていたので、隠れた行へ移れず文末へ飛んでいた
      const { editor, textarea } = setup({ value: "あ".repeat(400) });
      editor.commands.setSelection(0);
      key(textarea, "PageDown");

      const head = editor.state.selection.head;
      expect(head).toBeGreaterThan(0);
      expect(head).toBeLessThan(400);
    });

    it("ブロック方向へ繰り返し動いても文末へ飛ばない", () => {
      const { nextLine } = arrows();
      const { editor, textarea } = setup({ value: "あ".repeat(400) });
      editor.commands.setSelection(0);

      const seen: number[] = [];
      for (let i = 0; i < 8; i++) {
        key(textarea, nextLine);
        seen.push(editor.state.selection.head);
      }

      // 行ごとに進むだけ。順番も崩れない
      expect(seen).toEqual([...seen].sort((a, b) => a - b));
      expect(seen[seen.length - 1]).toBeLessThan(400);
    });

    it("改行だけの本文でも行頭へ戻れる", () => {
      // 改行の矩形は潰れているので、行の中を引くときに読み飛ばしてしまっていた
      const { prevLine } = arrows();
      const { editor, textarea } = setup({ value: "\n" });
      editor.commands.setSelection(1);
      key(textarea, prevLine);
      key(textarea, "Home");
      expect(editor.state.selection.head).toBe(0);
    });

    it.each(["", "\n", "\n\n\n", "あい\n", "\nあい", "あ"])(
      "%j でもキャレットが本文の外へ出ない",
      (value) => {
        const { editor, textarea } = setup({ value });
        editor.commands.setSelection(value.length);

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
          expect(editor.state.selection.head).toBeGreaterThanOrEqual(0);
          expect(editor.state.selection.head).toBeLessThanOrEqual(value.length);
        }
      },
    );

    it("全選択できる", () => {
      const { editor, textarea } = setup({ value: "あいう" });
      key(textarea, "a", { metaKey: true });
      expect(editor.state.selection).toEqual({ anchor: 0, head: 3 });
    });
  });

  describe("指で触る", () => {
    it("スワイプしただけならキーボードを開かない", () => {
      const { container, textarea } = setup({ value: "あ".repeat(400) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      // 指を置いただけでは、タップしたのかスクロールなのかまだ決まらない
      expect(document.activeElement).not.toBe(textarea);

      pointer(container, "pointermove", { clientX: at.clientX - 60, clientY: at.clientY });
      pointer(container, "pointerup", { clientX: at.clientX - 60, clientY: at.clientY });
      expect(document.activeElement).not.toBe(textarea);
    });

    it("軽くタップしたらそこにキャレットが来る", () => {
      const { container, editor, textarea } = setup({ value: "あ".repeat(400) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      expect(document.activeElement).toBe(textarea);
      expect(editor.state.selection.head).toBeGreaterThan(0);
    });

    it("ブラウザがスクロールを取ったらタップした扱いにしない", () => {
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
      expect(editor.state.selection.head).toBeGreaterThan(0);
    });

    it("タップした場所はコンテナが縮んでも動かない", async () => {
      // キーボードは何段階かに分けて出てくる。組み直るたびに、クリックした行は画面の同じところに残す
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      // 先頭からずらしておく。スクロールが 0 のままだと戻す先が合っていなくても気づけない
      editor.commands.setSelection(600);
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

    it("スワイプしてからタップしても、指の下にキャレットが来る", async () => {
      // focus の無いところをタップすると、focus を入れた時点で「古いキャレットを見せる」スクロールが入る。
      // スワイプして古いキャレットを画面の外へ出しておくと、それに引っ張られて別の列に着く
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      editor.focus();
      editor.commands.setSelection(200);
      await nextFrames();
      // キーボードを閉じた直後と同じ状態にして、指でスワイプする
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

      editor.commands.setSelection(10, 30);
      const rect = editor.selectionRect;
      if (!rect) throw new Error("選択しているのに矩形が無い");
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);

      // 両端のキャレットを含む
      editor.commands.setSelection(10);
      const head = editor.caretRect;
      editor.commands.setSelection(30);
      const tail = editor.caretRect;
      for (const point of [head, tail]) {
        expect(point.x).toBeGreaterThanOrEqual(rect.x - 1);
        expect(point.x + point.width).toBeLessThanOrEqual(rect.x + rect.width + 1);
        expect(point.y).toBeGreaterThanOrEqual(rect.y - 1);
        expect(point.y + point.height).toBeLessThanOrEqual(rect.y + rect.height + 1);
      }
    });

    it("長押しでキャレットを置き、そのままドラッグして動かせる", async () => {
      // iOS の編集可能なテキストと同じ割り当て。単語選択はダブルタップ側に持たせる
      const { container, editor, textarea } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(document.activeElement).toBe(textarea);
      const placed = editor.state.selection;
      expect(placed.anchor).toBe(placed.head);

      // 掴んだままスワイプすると、キャレットが付いてくる (選択は伸びない)
      pointer(container, "pointermove", {
        clientX: at.clientX + 40,
        clientY: at.clientY + 40,
      });
      pointer(container, "pointerup", { clientX: at.clientX + 40, clientY: at.clientY + 40 });
      const moved = editor.state.selection;
      expect(moved.anchor).toBe(moved.head);
      expect(moved.head).not.toBe(placed.head);
    });

    it("スワイプしている間は長押しにならない", async () => {
      const { container, editor, textarea } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);
      const moved = { clientX: at.clientX - 40, clientY: at.clientY - 40 };

      pointer(container, "pointerdown", at);
      pointer(container, "pointermove", moved);
      await new Promise((resolve) => setTimeout(resolve, 600));
      pointer(container, "pointerup", moved);

      // スワイプしただけ。キーボードも出さないし、キャレットも動かさない
      expect(document.activeElement).not.toBe(textarea);
      expect(editor.state.selection).toEqual({ anchor: 0, head: 0 });
    });

    it("続けて 2 回タップすると単語、3 回で段落を選ぶ", () => {
      // 合成マウスイベントは止めてあるので、ダブルクリックの detail は当てにできない
      const { container, editor } = setup({ value: "吾輩は猫である。\nここで段落が変わる。" });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      expect(editor.state.selection.anchor).toBe(editor.state.selection.head);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      const word = editor.state.selection;
      expect(Math.abs(word.head - word.anchor)).toBeGreaterThan(0);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      const paragraph = editor.state.selection;
      expect(Math.abs(paragraph.head - paragraph.anchor)).toBeGreaterThan(
        Math.abs(word.head - word.anchor),
      );
    });

    it("単語を選んだままドラッグすると伸びる", () => {
      const { container, editor } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      pointer(container, "pointerdown", at);
      const word = editor.state.selection;

      pointer(container, "pointermove", { clientX: at.clientX + 50, clientY: at.clientY + 50 });
      pointer(container, "pointerup", { clientX: at.clientX + 50, clientY: at.clientY + 50 });

      const grown = editor.state.selection;
      expect(grown.anchor).toBe(word.anchor);
      expect(Math.abs(grown.head - grown.anchor)).toBeGreaterThan(
        Math.abs(word.head - word.anchor),
      );
    });

    it.runIf(ctor === DomTextarea)("ハンドルは選択の両端に出る", async () => {
      const { container, editor } = setup({ value: "吾輩は猫である。名前はまだ無い。".repeat(10) });
      const vertical = writingMode === "vertical-rl";
      const at = middle(container);

      // キャレットだけのときは出さない (iOS と同じ。丸が出るのは選択の端だけ)
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      await nextFrames();
      expect(container.querySelectorAll("[data-handle]")).toHaveLength(0);

      // 続けてタップして単語を選ぶと、両端に 1 つずつ
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      await nextFrames();
      const dots = [...container.querySelectorAll("[data-handle]")] as HTMLElement[];
      expect(dots.map((el) => el.dataset.handle)).toEqual(["start", "end"]);

      // 丸は棒からブロック方向の外側へ、半径ぶん押し出したところ
      const { anchor, head } = editor.state.selection;
      const [from, to] = anchor <= head ? [anchor, head] : [head, anchor];
      const box = container.getBoundingClientRect();
      const centerOf = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2 - box.x, y: r.y + r.height / 2 - box.y };
      };
      const radius = 6;
      // 測る前に控える。選択を畳むとハンドルは消えてしまう
      const [startDot, endDot] = [centerOf(dots[0]), centerOf(dots[1])];

      editor.commands.setSelection(from);
      await nextFrames();
      // 座標は実測から出るので端数を持つ。1px 未満は見ない
      const near = (got: { x: number; y: number }, want: { x: number; y: number }) => {
        expect(got.x).toBeCloseTo(want.x, 1);
        expect(got.y).toBeCloseTo(want.y, 1);
      };

      const startBar = editor.caretRect;
      near(
        startDot,
        vertical
          ? { x: startBar.x + startBar.width + radius, y: startBar.y }
          : { x: startBar.x, y: startBar.y - radius },
      );

      editor.commands.setSelection(to);
      await nextFrames();
      const endBar = editor.caretRect;
      near(
        endDot,
        vertical
          ? { x: endBar.x - radius, y: endBar.y }
          : { x: endBar.x, y: endBar.y + endBar.height + radius },
      );
    });

    it.runIf(ctor === DomTextarea)("選択の端のハンドルを引くと、その端だけ動く", async () => {
      // ハンドルは指の作法なので dom 経路だけが持つ
      const { container, editor } = setup({ value: "吾輩は猫である。".repeat(40) });
      const at = middle(container);

      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);
      await nextFrames();
      const word = editor.state.selection;

      const handle = container.querySelector('[data-handle="end"]') as HTMLElement | null;
      if (!handle) throw new Error("ハンドルが描かれていない");
      const box = handle.getBoundingClientRect();
      const from = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
      const to = { clientX: from.clientX + 30, clientY: from.clientY + 30 };

      pointer(container, "pointerdown", from);
      pointer(container, "pointermove", to);
      pointer(container, "pointerup", to);

      // 掴んでいない側 (anchor) は動かない
      const grown = editor.state.selection;
      expect(grown.anchor).toBe(word.anchor);
      expect(grown.head).not.toBe(word.head);
    });

    it("コンテナが縮んだら、隠し入力も中へ置き直す", async () => {
      // iOS はキーボードの下に取り残された入力を見つけると、開いた直後に閉じてしまう
      const { container, editor, textarea } = setup({ value: "あ".repeat(2000) });
      editor.focus();
      editor.commands.setSelection(600);
      await nextFrames();

      // キーボードが出てくる側 (下端) の近くをタップする
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
      // 開く時と同じで、閉じる時もコンテナが変わって全部組み直る。
      // focus が外れたあとなので、戻す先を持っていないと読んでいた場所ごと飛ぶ
      const { container, editor, textarea } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      const blockOfCaret = () => {
        const rect = editor.caretRect;
        return vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      };

      editor.focus();
      editor.commands.setSelection(600);
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

      // 閉じる。focus が外れてからコンテナが戻る
      editor.blur();
      if (vertical) container.style.height = "200px";
      else container.style.width = "300px";
      await nextFrames();

      expect(Math.abs(blockOfCaret() - before)).toBeLessThan(1);
    });

    it("潰れる側をタップしても、キャレットは画面に残る", async () => {
      // コンテナはブロック方向にも潰れる。潰れた側をタップしていると、戻す先がそのまま画面の外になる
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      editor.commands.setSelection(600);
      await nextFrames();

      // コンテナが減る側 (縦書きなら右端、横書きなら下端) の近くをタップする
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
      ["ホイールでスクロールしたら", "wheel"],
      ["指でスワイプしたら", "pan"],
      ["外からスクロールしたら", "api"],
    ])("%s、タップした場所には戻さない", async (_name, how) => {
      const { container, editor } = setup({ value: "あ".repeat(2000) });
      const vertical = writingMode === "vertical-rl";
      editor.commands.setSelection(600);
      await nextFrames();

      const at = middle(container);
      pointer(container, "pointerdown", at);
      pointer(container, "pointerup", at);

      // 自分でスクロールした先が見たい位置。キャレットは画面の外へ出る
      if (how === "wheel") {
        const surface = container.firstElementChild as HTMLElement;
        surface.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 2000 }),
        );
      } else if (how === "api") {
        // 外からスクロールする。ホイールと同じで、掴んだ場所へは戻さない
        editor.scrollOffset += 2000;
      } else {
        // 指のパンはブラウザがスクロールさせる。こちらに届くのは「タップしなかった」ことだけ。
        // タップした場所から始めると、続けてタップした扱い (単語を掴んで伸ばす) になる
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

      // 戻す約束は解けている。見えるところまでスクロールするだけなので、キャレットはコンテナの端の行に着く。
      // 端に寄せるのは行ボックス (36px) なので、キャレットの中心は余白から半行ぶん内側
      const rect = editor.caretRect;
      const center = vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      const size = vertical ? container.clientWidth : container.clientHeight;
      const edge = 10 + 36 / 2;
      expect(Math.min(Math.abs(center - edge), Math.abs(size - edge - center))).toBeLessThan(1);
    });
  });

  describe("マウス", () => {
    // **本物の入力で打つ。**自作した PointerEvent では detail のようにブラウザが
    // 作る値を持てないので、回数の配線はこれでしか踏めない
    it("ダブルクリックで語、トリプルクリックで段落を選ぶ", async () => {
      const { container, editor } = setup({ value: "吾輩は猫である。\n名前はまだ無い。" });
      const surface = container.firstElementChild as HTMLElement;

      await userEvent.dblClick(surface);
      const word = editor.state.selection;
      expect(Math.abs(word.head - word.anchor)).toBeGreaterThan(0);

      await userEvent.tripleClick(surface);
      const paragraph = editor.state.selection;
      expect(Math.abs(paragraph.head - paragraph.anchor)).toBeGreaterThan(
        Math.abs(word.head - word.anchor),
      );
    });

    it("1 回のクリックはキャレットを置くだけ", async () => {
      const { container, editor } = setup({ value: "吾輩は猫である。" });
      const surface = container.firstElementChild as HTMLElement;
      await userEvent.click(surface);
      expect(editor.state.selection.anchor).toBe(editor.state.selection.head);
    });
  });

  describe("スクロール", () => {
    // 行送りに端数を出す (16 × 1.8 = 28.8)。デモの既定と同じで、
    // 整数に丸まる寸法だと端までスクロールしても食い違いが起きない
    const FRACTION = { size: 16, lineHeight: 1.8, padding: 10 };

    const wheel = (container: HTMLElement) =>
      (container.firstElementChild as HTMLElement).dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 400 }),
      );

    it("ホイールでブロック方向へスクロールする", () => {
      const { container, editor } = setup({ value: "あ".repeat(2000) }, FRACTION);
      expect(editor.scrollOffset).toBe(0);
      wheel(container);
      expect(editor.scrollOffset).toBeGreaterThan(0);
    });

    it("全選択ではスクロールしない。そのあと動かせば動く", async () => {
      // いま指した一点が無いので画面に入れる相手が居ない。ネイティブの textarea も動かさない
      const { container, editor, textarea } = setup({ value: "あ".repeat(2000) }, FRACTION);
      const { prevChar } = arrows();
      editor.focus();
      editor.commands.setSelection(0);
      // ResizeObserver の初回を先に流す。コンテナが変わったときは follow が
      // キャレットを追うので、混ぜると全選択のせいに見えてしまう。
      // 送りが落ち着くまで待つ (初回の observer は rAF を跨いで来ることがある)
      await settled(() => editor.scrollOffset);
      for (let i = 0; i < 5; i++) wheel(container);
      const away = editor.scrollOffset;
      expect(away).toBeGreaterThan(0);

      key(textarea, "a", { metaKey: true });
      await nextFrames();
      expect(editor.state.selection).toEqual({ anchor: 0, head: 2000 });
      expect(editor.scrollOffset).toBeCloseTo(away, 0);

      // 選択を畳むと文頭へ動くので、そこで初めてスクロールする
      key(textarea, prevChar);
      await nextFrames();
      expect(editor.scrollOffset).toBeLessThan(away);
    });

    it("スクロールしきってから回しても先頭へ戻らない", () => {
      // ブラウザがスクロールできる量は整数、こちらの見積もりは端数を持つ。
      // 端でその差を規約の違いと読むと、正の値を書いて先頭へ飛んでいた
      const { container, editor } = setup({ value: "あ".repeat(2000) }, FRACTION);
      for (let i = 0; i < 60; i++) wheel(container);
      const end = editor.scrollOffset;
      expect(end).toBeGreaterThan(0);
      wheel(container);
      expect(editor.scrollOffset).toBeCloseTo(end, 0);
    });
  });

  describe("undo と redo", () => {
    it("打った文字をまとめて戻す", () => {
      const { editor, textarea } = setup();
      type(textarea, "あ");
      type(textarea, "い");
      editor.commands.undo();
      expect(editor.state.value).toBe("");
      editor.commands.redo();
      expect(editor.state.value).toBe("あい");
    });

    it("キャレットを動かすと戻す単位が切れる", () => {
      const { editor, textarea } = setup();
      type(textarea, "あ");
      editor.commands.setSelection(0);
      type(textarea, "い");
      editor.commands.undo();
      expect(editor.state.value).toBe("あ");
    });
  });

  describe("外から触る", () => {
    it("setValue は onChange を呼ばない", () => {
      const seen: string[] = [];
      const { editor } = setup({ onChange: (value) => seen.push(value) });
      editor.commands.setValue("あい");
      expect(editor.state.value).toBe("あい");
      expect(seen).toEqual([]);
    });

    it("setValue は選択を文字数に収める", () => {
      const { editor } = setup({ value: "あいうえお" });
      editor.commands.setSelection(4, 5);
      editor.commands.setValue("あ");
      expect(editor.state.selection).toEqual({ anchor: 1, head: 1 });
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
      editor.commands.setSelection(0, 5);
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

      // 描けたことは例外が飛ばないことで見る。中身は state で確かめる
      expect(editor.state.composing).toBe(true);
    });

    it("空なら placeholder を組む", async () => {
      // placeholder の見え方はバックエンドごとなので、組めることだけ見る
      const { editor } = setup({ placeholder: "ここに書く" });
      await nextFrames();
      expect(editor.state.value).toBe("");
    });
  });

  describe("ポインタ", () => {
    // WebKit は pointerdown の preventDefault では合成マウスイベントを止めない。
    // touchend の後に届く mousedown に既定動作を許すと、focus が surface に移って
    // hidden input から focus が落ちる (iOS でタップしてもキャレットが出なくなる)
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
    editor.commands.setSelection(1);
    await painted();
    expect(container.querySelector("[data-caret]")).not.toBeNull();

    editor.commands.setSelection(1, 4);
    await painted();
    expect(container.querySelector("[data-caret]")).toBeNull();

    editor.commands.setSelection(4);
    await painted();
    expect(container.querySelector("[data-caret]")).not.toBeNull();
  });

  it("変換中の下線は縦書きなら字の左", async () => {
    // ネイティブの textarea に合わせる。既定 (auto) だと日本語のときだけ右へ回り、
    // 判定がフォントのスクリプト由来なのでホストページの lang にも振られる
    const { container, editor } = mount({ value: "あいう" });
    editor.focus();
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
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
    await painted();

    const spans = [...container.querySelectorAll("span")];
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(getComputedStyle(span).textUnderlinePosition).toBe("left");
    }
  });

  it("フォーカスが無ければキャレットを出さない", async () => {
    const { container, editor } = mount({ value: "あいうえお" });
    editor.commands.setSelection(1);
    await painted();
    expect(container.querySelector("[data-caret]")).toBeNull();
  });

  /** 点滅は時間で動くので、決め打ちで待たずに「そのうちこうなる」で見る */
  const until = async (want: boolean, limit = 2000) => {
    const started = performance.now();
    while (performance.now() - started < limit) {
      if (!!document.querySelector("[data-caret]") === want) return;
      await painted();
    }
    throw new Error(`キャレットが ${want ? "出" : "消え"}ないまま ${limit}ms 過ぎた`);
  };

  it("focus している間は点滅する", async () => {
    const { editor } = mount({ value: "あいうえお", caretBlinkInterval: 60 });
    editor.focus();
    editor.commands.setSelection(1);

    await until(true);
    await until(false);
    await until(true);
  });

  it("打ったら出た状態から数え直す", async () => {
    const { editor } = mount({ value: "あいうえお", caretBlinkInterval: 60 });
    editor.focus();
    editor.commands.setSelection(1);
    await until(false);

    // 消える番の途中でも、打てば出る
    editor.commands.insertText("か");
    await painted();
    expect(document.querySelector("[data-caret]")).not.toBeNull();
  });

  it("選択が伸びている間は数え直さない", async () => {
    // キャレットを出さないので、点滅で描き直しても何も変わらない。
    // dom は選択の矩形を取り直して div を作り直すので、選択が長いほど無駄が増える
    const { container, editor } = mount({
      value: "吾輩は猫である。".repeat(20),
      caretBlinkInterval: 60,
    });
    editor.focus();
    editor.commands.setSelection(0, 100);
    await painted();
    expect(document.querySelector("[data-caret]")).toBeNull();

    // 描き直しは層を空にしてから積み直す。取り除かれた回数を数えれば回数が出る
    let repaints = 0;
    const observer = new MutationObserver((records) => {
      repaints += records.filter((record) => record.removedNodes.length > 0).length;
    });
    for (const el of container.querySelectorAll("div")) observer.observe(el, { childList: true });
    const started = performance.now();
    while (performance.now() - started < 300) await painted();
    observer.disconnect();

    // 点滅していれば 60ms ごとに描き直す。落ち着くまでの 1 回は許す
    expect(repaints).toBeLessThanOrEqual(1);
  });

  it("間隔が 0 なら点滅しない", async () => {
    const { editor } = mount({ value: "あいうえお", caretBlinkInterval: 0 });
    editor.focus();
    editor.commands.setSelection(1);
    await until(true);

    const started = performance.now();
    while (performance.now() - started < 300) {
      expect(document.querySelector("[data-caret]")).not.toBeNull();
      await painted();
    }
  });
});
