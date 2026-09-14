import { afterEach, describe, expect, it } from "vitest";
import { CanvasTextarea } from "../../src/canvas/index";
import { DomTextarea } from "../../src/dom/index";
import type { Textarea } from "../../src/textarea";
import type { TextareaOptions } from "../../src/types";

/**
 * 2 つのバックエンドが同じ操作で同じところに着くことを縛る。
 * 片方が正しくてももう片方がずれていたら、どちらかがバグっている。
 *
 * 本文は全角だけにする。ラテンは canvas が 1 字ずつ測り、dom は
 * ブラウザがまとめて整形するので、送りが一致しなくて当たり前。
 */

const SIZE = 20;
const LINE_HEIGHT = 1.8;
const PADDING = 20;
// 高さ 240 - padding 40 = 200 → 1 行 10 文字
const WIDTH = 200;
const HEIGHT = 240;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function mount(Ctor: new (host: HTMLElement, options: TextareaOptions) => Textarea, value: string) {
  const host = document.createElement("div");
  Object.assign(host.style, { width: `${WIDTH}px`, height: `${HEIGHT}px` });
  document.body.appendChild(host);
  const editor = new Ctor(host, {
    value,
    font: { size: SIZE, lineHeight: LINE_HEIGHT },
    padding: PADDING,
    caretBlinkInterval: 0,
  });
  cleanups.push(() => {
    editor.destroy();
    host.remove();
  });
  return { host, editor, textarea: host.querySelector("textarea") as HTMLTextAreaElement };
}

function pair(value: string) {
  return { canvas: mount(CanvasTextarea, value), dom: mount(DomTextarea, value) };
}

interface Step {
  label: string;
  anchor: number;
  focus: number;
  lineCount: number;
  x: number;
  y: number;
}

function state(editor: Textarea, label = ""): Step {
  const rect = editor.caretRect;
  return {
    label,
    ...editor.selection,
    lineCount: editor.lineCount,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
  };
}

/** 座標は出し方が違うので 2px まで許す。offset と行数は厳密に合わせる */
function expectSame(canvasSteps: Step[], domSteps: Step[]) {
  const diffs = canvasSteps.flatMap((c, i) => {
    const d = domSteps[i];
    const ok =
      c.anchor === d.anchor &&
      c.focus === d.focus &&
      c.lineCount === d.lineCount &&
      Math.abs(c.x - d.x) <= 2 &&
      Math.abs(c.y - d.y) <= 2;
    return ok
      ? []
      : [
          `${c.label}: canvas[${c.anchor},${c.focus}](${c.x},${c.y})L${c.lineCount}` +
            ` / dom[${d.anchor},${d.focus}](${d.x},${d.y})L${d.lineCount}`,
        ];
  });
  expect(diffs).toEqual([]);
}

function drive(
  target: { editor: Textarea; textarea: HTMLTextAreaElement },
  keys: readonly (readonly [string, KeyboardEventInit?])[],
): Step[] {
  return keys.map(([name, init]) => {
    key(target.textarea, name, init ?? {});
    return state(
      target.editor,
      `${name}${init?.shiftKey ? "+Shift" : ""}${init?.metaKey ? "+Meta" : ""}${init?.altKey ? "+Alt" : ""}`,
    );
  });
}

function key(textarea: HTMLTextAreaElement, name: string, init: KeyboardEventInit = {}) {
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
  );
}

function click(host: HTMLElement, clientX: number, clientY: number) {
  const surface = host.firstElementChild as HTMLElement;
  for (const type of ["pointerdown", "pointerup"]) {
    surface.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX,
        clientY,
        button: 0,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  }
}

const repeat = (count: number, name: string, init?: KeyboardEventInit) =>
  Array.from({ length: count }, () => [name, init] as const);

const wrap = "あいうえおかきくけこさしすせそたちつてと";
const long = "あ".repeat(400);
const mixed = "あい\nうえお\n\nかき";

describe("2 つのバックエンドが同じところに着く", () => {
  it.each([
    ["行を下へ連打", wrap, 0, repeat(25, "ArrowDown")],
    ["行を上へ連打", wrap, 20, repeat(25, "ArrowUp")],
    ["文字を左へ連打", wrap, 3, repeat(6, "ArrowLeft")],
    ["文字を右へ連打", wrap, 18, repeat(6, "ArrowRight")],
    ["長文で行を下へ連打", long, 0, repeat(30, "ArrowDown")],
    ["長文で PageDown", long, 0, repeat(8, "PageDown")],
    ["長文で PageUp", long, 399, repeat(8, "PageUp")],
    ["Shift で行を伸ばす", wrap, 5, repeat(15, "ArrowDown", { shiftKey: true })],
    ["改行混じりで行を下へ", mixed, 0, repeat(14, "ArrowDown")],
    ["改行混じりで行を上へ", mixed, 12, repeat(14, "ArrowUp")],
    ["段落の端へ", mixed, 5, repeat(6, "ArrowDown", { altKey: true })],
  ])("%s", (_label, value, start, keys) => {
    const { canvas, dom } = pair(value);
    canvas.editor.setSelection(start);
    dom.editor.setSelection(start);

    expectSame(drive(canvas, keys), drive(dom, keys));
  });

  it.each([
    ["行頭行末", wrap, 12, [["End"], ["Home"], ["ArrowDown"], ["End"], ["Home"], ["ArrowUp"]]],
    [
      "文頭文末",
      wrap,
      8,
      [
        ["ArrowDown", { metaKey: true }],
        ["ArrowUp", { metaKey: true }],
      ],
    ],
  ] as const)("%s", (_label, value, start, keys) => {
    const { canvas, dom } = pair(value);
    canvas.editor.setSelection(start);
    dom.editor.setSelection(start);

    expectSame(drive(canvas, keys), drive(dom, keys));
  });

  it.each(["", "\n", "\n\n\n", "あい\n", "\nあい", "あ"])("端の本文 %j", (value) => {
    const { canvas, dom } = pair(value);
    canvas.editor.setSelection(value.length);
    dom.editor.setSelection(value.length);

    const keys = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].map((name) => [name] as const);
    expectSame(drive(canvas, keys), drive(dom, keys));
  });

  it("折り返しの境目はどちらから突いたかで着く行が変わる", () => {
    const { canvas, dom } = pair(wrap);
    const lineHeight = SIZE * LINE_HEIGHT;
    const column = (host: HTMLElement, index: number) =>
      host.getBoundingClientRect().right - PADDING - lineHeight * (index + 0.5);
    const top = (host: HTMLElement) => host.getBoundingClientRect().top + PADDING;

    // 1 行目の末尾側を突く
    click(canvas.host, column(canvas.host, 0), top(canvas.host) + 199);
    click(dom.host, column(dom.host, 0), top(dom.host) + 199);
    const atLineEnd = state(canvas.editor, "1行目の末尾");
    expectSame([atLineEnd], [state(dom.editor, "1行目の末尾")]);

    // 2 行目の頭側を突く。offset は同じでも着く行が違う
    click(canvas.host, column(canvas.host, 1), top(canvas.host) + 1);
    click(dom.host, column(dom.host, 1), top(dom.host) + 1);
    const atLineStart = state(canvas.editor, "2行目の頭");
    expectSame([atLineStart], [state(dom.editor, "2行目の頭")]);

    expect(atLineStart.focus).toBe(atLineEnd.focus);
    expect(atLineStart.x).toBeLessThan(atLineEnd.x);
    expect(atLineStart.y).toBeLessThan(atLineEnd.y);
  });

  it("送ってからでも同じところを突ける", () => {
    const { canvas, dom } = pair(long);
    const lineHeight = SIZE * LINE_HEIGHT;
    canvas.editor.scrollOffset = lineHeight * 3;
    dom.editor.scrollOffset = lineHeight * 3;
    expect(dom.editor.scrollOffset).toBe(canvas.editor.scrollOffset);

    for (const host of [canvas.host, dom.host]) {
      const box = host.getBoundingClientRect();
      click(host, box.right - PADDING - lineHeight * 0.5, box.top + PADDING + 30);
    }
    expectSame([state(canvas.editor, "送ってから突く")], [state(dom.editor, "送ってから突く")]);
  });

  it("編集したあとも揃っている", () => {
    const cases: ((editor: Textarea) => void)[] = [
      (e) => {
        e.selectAll();
        e.insertText("か");
      },
      (e) => {
        e.setSelection(2, 8);
        e.insertText("");
      },
      (e) => {
        e.insertText("かき");
        e.undo();
      },
      (e) => {
        e.insertText("かき");
        e.undo();
        e.redo();
      },
      (e) => {
        e.setSelection(9);
        e.setValue("あ");
      },
    ];

    cases.forEach((edit, index) => {
      const { canvas, dom } = pair(wrap);
      edit(canvas.editor);
      edit(dom.editor);
      expectSame([state(canvas.editor, `編集 ${index}`)], [state(dom.editor, `編集 ${index}`)]);
    });
  });

  it("caretPositionFromPoint が無くても突ける (Safari 18.2 未満)", () => {
    const original = Object.getOwnPropertyDescriptor(document, "caretPositionFromPoint");
    // 古い WebKit には caretRangeFromPoint しかない
    Object.defineProperty(document, "caretPositionFromPoint", {
      value: undefined,
      configurable: true,
    });
    try {
      const { canvas, dom } = pair(wrap);
      const lineHeight = SIZE * LINE_HEIGHT;
      for (const host of [canvas.host, dom.host]) {
        const box = host.getBoundingClientRect();
        click(host, box.right - PADDING - lineHeight * 0.5, box.top + PADDING + 65);
      }
      const landed = state(canvas.editor, "fallback");
      expect(landed.focus).toBeGreaterThan(0);
      expectSame([landed], [state(dom.editor, "fallback")]);
    } finally {
      if (original) Object.defineProperty(document, "caretPositionFromPoint", original);
      else Reflect.deleteProperty(document, "caretPositionFromPoint");
    }
  });
});
