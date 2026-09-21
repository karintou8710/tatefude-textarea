import { afterEach, describe, expect, it } from "vitest";
import type { Backend } from "../../src/backend/backend";
import { CanvasBackend } from "../../src/backend/canvas/backend";
import { resolveCanvasStyle } from "../../src/backend/canvas/style";
import { DomBackend } from "../../src/backend/dom/backend";
import { Textarea } from "../../src/textarea";
import { resolveOptions, type TextareaOptions } from "../../src/types";
import { applyStyle, canvasStyle } from "./style";

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

interface Mounted {
  host: HTMLElement;
  editor: Textarea;
  /** 行数は公開 API に無いので、バックエンドを直に持つ */
  backend: Backend;
  textarea: HTMLTextAreaElement;
}

function mount(kind: "canvas" | "dom", value: string, family?: string, height = HEIGHT): Mounted {
  const style = { size: SIZE, lineHeight: LINE_HEIGHT, padding: PADDING, family };
  const host = document.createElement("div");
  Object.assign(host.style, { width: `${WIDTH}px`, height: `${height}px` });
  applyStyle(host, style);
  document.body.appendChild(host);

  const options: TextareaOptions = { value, caretBlinkInterval: 0 };
  const resolved = resolveOptions(options);
  const backend: Backend =
    kind === "canvas"
      ? new CanvasBackend(host, resolved, resolveCanvasStyle(canvasStyle(style)))
      : new DomBackend(host, resolved);
  const editor = new Textarea(host, { ...options, backend });
  cleanups.push(() => {
    editor.destroy();
    host.remove();
  });
  return { host, editor, backend, textarea: host.querySelector("textarea") as HTMLTextAreaElement };
}

function pair(value: string, family?: string, height?: number) {
  return {
    canvas: mount("canvas", value, family, height),
    dom: mount("dom", value, family, height),
  };
}

interface Step {
  label: string;
  anchor: number;
  focus: number;
  lineCount: number;
  x: number;
  y: number;
}

function state(mounted: Mounted, label = ""): Step {
  const rect = mounted.editor.caretRect;
  return {
    label,
    ...mounted.editor.state.selection,
    lineCount: mounted.backend.lineCount,
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

function drive(target: Mounted, keys: readonly (readonly [string, KeyboardEventInit?])[]): Step[] {
  return keys.map(([name, init]) => {
    key(target.textarea, name, init ?? {});
    return state(
      target,
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
    // 縦書きなので、字送りが ↑↓ で行送りが ←→
    ["行を次へ連打", wrap, 0, repeat(25, "ArrowLeft")],
    ["行を前へ連打", wrap, 20, repeat(25, "ArrowRight")],
    ["文字を戻る連打", wrap, 3, repeat(6, "ArrowUp")],
    ["文字を進む連打", wrap, 18, repeat(6, "ArrowDown")],
    ["長文で行を次へ連打", long, 0, repeat(30, "ArrowLeft")],
    ["長文で PageDown", long, 0, repeat(8, "PageDown")],
    ["長文で PageUp", long, 399, repeat(8, "PageUp")],
    ["Shift で行を伸ばす", wrap, 5, repeat(15, "ArrowLeft", { shiftKey: true })],
    ["改行混じりで行を次へ", mixed, 0, repeat(14, "ArrowLeft")],
    ["改行混じりで行を前へ", mixed, 12, repeat(14, "ArrowRight")],
    ["段落の端へ", mixed, 5, repeat(6, "ArrowLeft", { altKey: true })],
  ])("%s", (_label, value, start, keys) => {
    const { canvas, dom } = pair(value);
    canvas.editor.commands.setSelection(start);
    dom.editor.commands.setSelection(start);

    expectSame(drive(canvas, keys), drive(dom, keys));
  });

  it.each([
    ["行頭行末", wrap, 12, [["End"], ["Home"], ["ArrowLeft"], ["End"], ["Home"], ["ArrowRight"]]],
    [
      "文頭文末",
      wrap,
      8,
      [
        ["ArrowLeft", { metaKey: true }],
        ["ArrowRight", { metaKey: true }],
      ],
    ],
  ] as const)("%s", (_label, value, start, keys) => {
    const { canvas, dom } = pair(value);
    canvas.editor.commands.setSelection(start);
    dom.editor.commands.setSelection(start);

    expectSame(drive(canvas, keys), drive(dom, keys));
  });

  it.each(["", "\n", "\n\n\n", "あい\n", "\nあい", "あ"])("端の本文 %j", (value) => {
    const { canvas, dom } = pair(value);
    canvas.editor.commands.setSelection(value.length);
    dom.editor.commands.setSelection(value.length);

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
    const atLineEnd = state(canvas, "1行目の末尾");
    expectSame([atLineEnd], [state(dom, "1行目の末尾")]);

    // 2 行目の頭側を突く。offset は同じでも着く行が違う
    click(canvas.host, column(canvas.host, 1), top(canvas.host) + 1);
    click(dom.host, column(dom.host, 1), top(dom.host) + 1);
    const atLineStart = state(canvas, "2行目の頭");
    expectSame([atLineStart], [state(dom, "2行目の頭")]);

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
    expectSame([state(canvas, "送ってから突く")], [state(dom, "送ってから突く")]);
  });

  /**
   * 立てた字の縦の送りは 1em とは限らない。フォントに縦組みの寸法が無ければ
   * ブラウザは ascent + descent から作る。canvas 側が 1em と決め打つと、
   * 本文の長いところで折り返しが 1 行ずつずれていく。
   * どのフォントが落ちてくるかは OS で変わるので、絶対値ではなく 2 実装の一致だけを見る。
   */
  it.each(["system-ui", "serif", "sans-serif", "monospace"])(
    "縦の送りが 1em でない %s でも揃う",
    (family) => {
      // 行の長さを少しずつ変える。送りを 1em と決め打っていると、
      // どこかで 1 行に入る字数がずれる
      const counts = [190, 200, 210, 220, 230, 240].map((height) => {
        const { canvas, dom } = pair(long, family, height);
        return [`${height}: ${canvas.backend.lineCount}`, `${height}: ${dom.backend.lineCount}`];
      });
      expect(counts.map(([c]) => c)).toEqual(counts.map(([, d]) => d));

      const { canvas, dom } = pair(long, family);
      const keys = repeat(20, "ArrowLeft");
      expectSame(drive(canvas, keys), drive(dom, keys));
    },
  );

  it("編集したあとも揃っている", () => {
    const cases: ((editor: Textarea) => void)[] = [
      (e) => {
        e.commands.selectAll();
        e.commands.insertText("か");
      },
      (e) => {
        e.commands.setSelection(2, 8);
        e.commands.insertText("");
      },
      (e) => {
        e.commands.insertText("かき");
        e.commands.undo();
      },
      (e) => {
        e.commands.insertText("かき");
        e.commands.undo();
        e.commands.redo();
      },
      (e) => {
        e.commands.setSelection(9);
        e.commands.setValue("あ");
      },
    ];

    cases.forEach((edit, index) => {
      const { canvas, dom } = pair(wrap);
      edit(canvas.editor);
      edit(dom.editor);
      expectSame([state(canvas, `編集 ${index}`)], [state(dom, `編集 ${index}`)]);
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
      const landed = state(canvas, "fallback");
      expect(landed.focus).toBeGreaterThan(0);
      expectSame([landed], [state(dom, "fallback")]);
    } finally {
      if (original) Object.defineProperty(document, "caretPositionFromPoint", original);
      else Reflect.deleteProperty(document, "caretPositionFromPoint");
    }
  });
});
