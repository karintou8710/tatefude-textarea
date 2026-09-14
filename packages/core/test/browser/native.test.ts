import { server, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasTextarea } from "../../src/canvas/index";
import { DomTextarea } from "../../src/dom/index";
import type { Textarea } from "../../src/textarea";
import type { TextareaOptions } from "../../src/types";

/**
 * Blink の <textarea> を基準にする。
 * 縦書きのキャレット移動がどう動くのが「普通」なのかは、
 * 仕様書よりブラウザの実装が答えなので、隣に置いて同じキーを打つ。
 *
 * 矢印の割り当てだけは Blink 自身が OS で割れている。
 * Linux / Windows は画面の向きのまま (縦書きなら ↓ が次の字、← が次の行) で、
 * これはこちらの割り当てと同じ。macOS だけは矢印が OS のキーバインドから来るので、
 * 縦書きでも ←→ が字送りのままになる。
 * そこで cases はネイティブに打つキーで書き、macOS のときだけ軸を入れ替えて打つ。
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

/** 同じ意味になるキーへ。縦書きでは字送りと行送りの軸が入れ替わる */
const ROTATE: Record<string, string> = {
  ArrowRight: "ArrowDown",
  ArrowLeft: "ArrowUp",
  ArrowDown: "ArrowLeft",
  ArrowUp: "ArrowRight",
};

// macOS の Blink だけ縦書きの矢印が論理のまま。ほかの OS は元から同じ割り当て
const rotates = server.platform === "darwin";

function rotate(stroke: string): string {
  if (!rotates) return stroke;
  return stroke.replace(/Arrow(Up|Down|Left|Right)/g, (key) => ROTATE[key]);
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
    await userEvent.keyboard(rotate(stroke));
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
const DEMO = "吾輩は猫である。名前はまだ無い。\nどこで生れたかとんと見当がつかぬ。\n\nにゃー";
// 1 行目は改行で切れて短い。折り返しの境目 (13) から上へ動くと、
// 前の行の末尾に居たか次の行の先頭に居たかで着く先が分かれる
const WRAP = `あい\n${"う".repeat(15)}`;

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

  // デモに近い本文。段落と折り返しと空行が混ざる
  ["混在で下へ長く", DEMO, 3, Array(14).fill("{ArrowDown}")],
  ["混在で上へ長く", DEMO, 36, Array(14).fill("{ArrowUp}")],
  ["混在で右へ長く", DEMO, 10, Array(14).fill("{ArrowRight}")],
  ["混在で左へ長く", DEMO, 30, Array(14).fill("{ArrowLeft}")],
  ["折り返しの端から下へ", DEMO, 16, Array(6).fill("{ArrowDown}")],
  ["下ってから上る", DEMO, 5, [...Array(6).fill("{ArrowDown}"), ...Array(6).fill("{ArrowUp}")]],
  [
    "下と右を混ぜる",
    DEMO,
    5,
    ["{ArrowDown}", "{ArrowRight}", "{ArrowDown}", "{ArrowLeft}", "{ArrowDown}", "{ArrowUp}"],
  ],

  // 選んでいるときの ← → は、選んだ端に畳むだけで 1 文字は進まない
  [
    "選んでから左",
    PARAGRAPHS,
    1,
    [...Array(2).fill("{Shift>}{ArrowRight}{/Shift}"), "{ArrowLeft}"],
  ],
  [
    "選んでから右",
    PARAGRAPHS,
    1,
    [...Array(2).fill("{Shift>}{ArrowRight}{/Shift}"), "{ArrowRight}"],
  ],
  [
    "逆向きに選んでから右",
    PARAGRAPHS,
    3,
    [...Array(2).fill("{Shift>}{ArrowLeft}{/Shift}"), "{ArrowRight}"],
  ],

  // 端で動けなかった ← → は、行を移るときの狙いを消さない
  ["端で止まっても狙いは残る", "あいう\nかきく", 1, ["{ArrowUp}", "{ArrowLeft}", "{ArrowDown}"]],

  // 折り返しの境目に着いたキャレットは、次の行の先頭に居る
  ["右で折り返しの境目に着く", WRAP, 12, ["{ArrowRight}", "{ArrowUp}"]],
  ["左で折り返しの境目に着く", WRAP, 14, ["{ArrowLeft}", "{ArrowUp}"]],
  ["打って折り返しの境目に着く", WRAP, 12, ["ん", "{ArrowUp}"]],
  ["消して折り返しの境目に着く", WRAP, 14, ["{Backspace}", "{ArrowUp}"]],
];

/**
 * ⌘ と ⌥ の割り当ては macOS だけのもの。
 * Blink の表 (editing_behavior.cc) で ⌥ + 上下が段落送りになるのは Mac で、
 * Linux / Windows では Ctrl が同じ役をする。⌘ + 矢印に至っては表に無く、
 * Mac では OS のキーバインドから来る。だから本物と突き合わせられるのは Mac だけ。
 */
const macCases: [name: string, value: string, start: number, keys: string[]][] = [
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

// WebKit の textarea は縦書きの上下で別の答えを出す。
// ここで測りたいのは Blink なので、隣に並べる相手が Blink のときだけ回す
async function expectSameAsNative(value: string, start: number, keys: string[]) {
  const base = await traceNative(value, start, keys);
  const canvas = await traceOurs(CanvasTextarea, value, start, keys);
  const dom = await traceOurs(DomTextarea, value, start, keys);

  expect([...diff("canvas", base, canvas), ...diff("dom", base, dom)]).toEqual([]);
}

describe.runIf(server.browser === "chromium")("Blink の textarea と突き合わせる", () => {
  it.each(cases)("%s", async (_name, value, start, keys) => {
    await expectSameAsNative(value, start, keys);
  });

  describe.runIf(server.platform === "darwin")("macOS の割り当て", () => {
    it.each(macCases)("%s", async (_name, value, start, keys) => {
      await expectSameAsNative(value, start, keys);
    });
  });
});
