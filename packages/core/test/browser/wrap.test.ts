import { server, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasTextarea } from "../../src/backend/canvas/index";
import { DomTextarea } from "../../src/backend/dom/index";
import { applyStyle, canvasStyle } from "./style";

const SIZE = 20;
const LINE_HEIGHT = 1.8;
const PADDING = 0;
const LENGTH = 200; // 行の長さ (inline)
const BREADTH = 400;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function native(value: string) {
  const el = document.createElement("textarea");
  el.value = value;
  Object.assign(el.style, {
    font: `400 ${SIZE}px/${LINE_HEIGHT} serif`,
    width: `${LENGTH}px`,
    height: `${BREADTH}px`,
    padding: "0",
    border: "none",
    resize: "none",
    overflow: "hidden",
    boxSizing: "content-box",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  cleanups.push(() => el.remove());
  return el;
}

function ours(Ctor: typeof CanvasTextarea | typeof DomTextarea, value: string) {
  const style = { size: SIZE, lineHeight: LINE_HEIGHT, padding: PADDING, family: "serif" };
  const host = document.createElement("div");
  Object.assign(host.style, { width: `${LENGTH}px`, height: `${BREADTH}px` });
  applyStyle(host, style);
  document.body.appendChild(host);
  const editor = new Ctor(
    host,
    { value, writingMode: "horizontal-tb", caretBlinkInterval: 0 },
    canvasStyle(style),
  );
  cleanups.push(() => {
    editor.destroy();
    host.remove();
  });
  return { editor, textarea: host.querySelector("textarea") as HTMLTextAreaElement };
}

/** 行末 → 次の行 → 行末 … を繰り返して、折り返し位置を復元する */
async function lineEnds(read: () => number, focus: HTMLTextAreaElement, limit = 12) {
  focus.focus();
  // macOS の Home/End は文書の端。行頭行末は Meta + 左右
  await userEvent.keyboard("{Meta>}{ArrowUp}{/Meta}");
  const ends: number[] = [];
  for (let i = 0; i < limit; i++) {
    await userEvent.keyboard("{Meta>}{ArrowRight}{/Meta}");
    const end = read();
    if (ends.length && end === ends[ends.length - 1]) break;
    ends.push(end);
    await userEvent.keyboard("{ArrowDown}");
  }
  return ends;
}

const cases: [label: string, value: string][] = [
  ["全角だけ", "あ".repeat(40)],
  ["切れない英単語", "a".repeat(60)],
  ["空白入りの英文", "lorem ipsum dolor sit amet consectetur adipiscing elit sed do"],
  ["長い単語混じり", `ab cd ${"x".repeat(40)} ef`],
  ["タブ", `a\tb\tc\t${"d".repeat(30)}`],
  ["禁則", "あいうえおかきくけこ、さしすせそたちつてと。なにぬねの"],
  ["連続空白", `aa    bb    cc    ${"dd ".repeat(20)}`],
];

/**
 * 行末を ⌘ + → で辿るので macOS でしか測れない。
 * ほかの OS の Blink はこの割り当てを持たず、縦書きの ↑↓ ←→ の意味も違う。
 */
describe.runIf(server.platform === "darwin")("折り返す位置をネイティブ textarea に合わせる", () => {
  it.each(cases)(
    "%s",
    async (_label, value) => {
      const el = native(value);
      const base = await lineEnds(() => el.selectionStart, el);

      const c = ours(CanvasTextarea, value);
      expect(await lineEnds(() => c.editor.selection.focus, c.textarea)).toEqual(base);

      const d = ours(DomTextarea, value);
      expect(await lineEnds(() => d.editor.selection.focus, d.textarea)).toEqual(base);
    },
    30000,
  );
});
