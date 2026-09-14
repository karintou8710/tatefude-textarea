import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasTextarea } from "../../src/canvas/index";
import { DomTextarea } from "../../src/dom/index";
import type { Textarea } from "../../src/textarea";
import type { TextareaOptions } from "../../src/types";

/**
 * Blink の <textarea> を基準にする。
 * 縦書きのキャレット移動がどう動くのが「普通」なのかは、
 * 仕様書よりブラウザの実装が答えなので、隣に置いて同じキーを打つ。
 */

const SIZE = 20;
const LINE_HEIGHT = 1.8;
const PADDING = 20;
// 行の長さを 200px = 全角 10 文字に揃える
const LENGTH = 200;
const BREADTH = 240;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function native(value: string) {
  const element = document.createElement("textarea");
  element.value = value;
  Object.assign(element.style, {
    writingMode: "vertical-rl",
    font: `400 ${SIZE}px/${LINE_HEIGHT} serif`,
    width: `${BREADTH}px`,
    height: `${LENGTH}px`,
    padding: "0",
    border: "none",
    outline: "none",
    resize: "none",
    lineBreak: "strict",
    overflow: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(element);
  cleanups.push(() => element.remove());
  return element;
}

function ours(Ctor: new (host: HTMLElement, options: TextareaOptions) => Textarea, value: string) {
  const host = document.createElement("div");
  Object.assign(host.style, {
    width: `${BREADTH + PADDING * 2}px`,
    height: `${LENGTH + PADDING * 2}px`,
  });
  document.body.appendChild(host);
  const editor = new Ctor(host, {
    value,
    font: { size: SIZE, lineHeight: LINE_HEIGHT, family: "serif" },
    padding: PADDING,
    caretBlinkInterval: 0,
  });
  cleanups.push(() => {
    editor.destroy();
    host.remove();
  });
  return { host, editor, textarea: host.querySelector("textarea") as HTMLTextAreaElement };
}

async function traceNative(value: string, start: number, keys: string[]) {
  const element = native(value);
  element.focus();
  element.setSelectionRange(start, start);
  const steps: string[] = [];
  for (const stroke of keys) {
    await userEvent.keyboard(stroke);
    steps.push(`${stroke} [${element.selectionStart},${element.selectionEnd}]`);
  }
  return steps;
}

async function traceOurs(
  Ctor: new (host: HTMLElement, options: TextareaOptions) => Textarea,
  value: string,
  start: number,
  keys: string[],
) {
  const target = ours(Ctor, value);
  target.editor.focus();
  target.editor.setSelection(start);
  const steps: string[] = [];
  for (const stroke of keys) {
    await userEvent.keyboard(stroke);
    const { anchor, focus } = target.editor.selection;
    steps.push(`${stroke} [${Math.min(anchor, focus)},${Math.max(anchor, focus)}]`);
  }
  return steps;
}

function diff(label: string, base: string[], mine: string[]) {
  return base.flatMap((step, i) =>
    step === mine[i] ? [] : [`${label} ${i}: native ${step} / ours ${mine[i]}`],
  );
}

const PARAGRAPHS = "あいうえお\nかきくけこさしすせそたちつてと\nなにぬねの";

const cases: [name: string, value: string, start: number, keys: string[]][] = [
  ["改行を跨いで下へ", "あいう\nかきく", 0, Array(8).fill("{ArrowDown}")],
  ["改行を跨いで上へ", "あいう\nかきく", 7, Array(8).fill("{ArrowUp}")],
  ["改行を跨いで左へ", "あいう\nかきく", 1, Array(3).fill("{ArrowLeft}")],
  ["改行を跨いで右へ", "あいう\nかきく", 5, Array(3).fill("{ArrowRight}")],
  ["折り返しを跨いで下へ", "あ".repeat(25), 6, Array(8).fill("{ArrowDown}")],
  ["折り返しを跨いで左へ", "あ".repeat(25), 3, Array(4).fill("{ArrowLeft}")],
  ["折り返しを跨いで右へ", "あ".repeat(25), 22, Array(4).fill("{ArrowRight}")],
  ["空行を跨ぐ", "あ\n\nい", 0, Array(5).fill("{ArrowDown}")],
  ["末尾が改行", "あい\n", 0, Array(4).fill("{ArrowDown}")],
  ["Shift で伸ばす", "あ".repeat(25), 5, Array(6).fill("{Shift>}{ArrowDown}{/Shift}")],
  ["Shift で行を移る", "あ".repeat(25), 5, Array(2).fill("{Shift>}{ArrowDown}{/Shift}")],
  ["段落の頭へ", PARAGRAPHS, 12, Array(3).fill("{Alt>}{ArrowUp}{/Alt}")],
  ["段落の末へ", PARAGRAPHS, 12, Array(3).fill("{Alt>}{ArrowDown}{/Alt}")],
  ["文頭へ", PARAGRAPHS, 12, ["{Meta>}{ArrowUp}{/Meta}"]],
  ["文末へ", PARAGRAPHS, 12, ["{Meta>}{ArrowDown}{/Meta}"]],
  ["行頭へ", PARAGRAPHS, 12, ["{Meta>}{ArrowLeft}{/Meta}"]],
  ["行末へ", PARAGRAPHS, 12, ["{Meta>}{ArrowRight}{/Meta}"]],
];

/**
 * わざと合わせていないもの:
 * - Home / End / PageUp / PageDown … Blink は縦書きだと何もしない。使えるままにする
 * - Alt + 左右 (単語) … Blink は CJK を 1 文字ずつ刻む。Intl.Segmenter の方が日本語に合う
 */

describe("Blink の textarea と突き合わせる", () => {
  it.each(cases)("%s", async (_name, value, start, keys) => {
    const base = await traceNative(value, start, keys);
    const canvas = await traceOurs(CanvasTextarea, value, start, keys);
    const dom = await traceOurs(DomTextarea, value, start, keys);

    expect([...diff("canvas", base, canvas), ...diff("dom", base, dom)]).toEqual([]);
  });
});
