import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/edit/command";
import { setSelection } from "../../src/edit/selection";
import { type EditState, type Limits, newEditState } from "../../src/state/edit";
import { selection } from "../../src/state/query";
import { fakeLayout } from "../fake-layout";

const open: Limits = { editable: true, maxLength: Number.POSITIVE_INFINITY };
const locked: Limits = { editable: false, maxLength: Number.POSITIVE_INFINITY };

/**
 * 8 字で折り返すレイアウトを添えて用意する。
 * 本文を編集するとレイアウトは古くなるので、移動と編集は混ぜない
 */
function setup(text: string, linesPerPage = 2) {
  const layout = fakeLayout(text, 8, linesPerPage);
  const run = (state: EditState, command: Parameters<typeof runCommand>[1], limits = open) =>
    runCommand(state, command, layout, limits);
  return { state: newEditState(text), run };
}

describe("字送り", () => {
  it("1 つ進む", () => {
    const { state, run } = setup("あいうえお");
    const result = run(state, { type: "stepInline", direction: 1, word: false, extend: false });
    expect(result.changed).toBe("selection");
    expect(result.state.caret.offset).toBe(1);
    // 元の state は動かない
    expect(state.caret.offset).toBe(0);
  });

  it("選んでいるときは、選んだ端に畳むだけで進まない", () => {
    const { state, run } = setup("あいうえお");
    const selected = setSelection(state, 1, 3).state;
    const result = run(selected, { type: "stepInline", direction: 1, word: false, extend: false });
    expect(selection(result.state)).toEqual({ anchor: 3, focus: 3 });
  });

  it("端では何も動かない", () => {
    const { state, run } = setup("あいうえお");
    const result = run(state, { type: "stepInline", direction: -1, word: false, extend: false });
    expect(result.changed).toBe(null);
    expect(result.state).toBe(state);
  });

  it("extend なら掴んだ側を置いたまま伸びる", () => {
    const { state, run } = setup("あいうえお");
    const at = setSelection(state, 2).state;
    const result = run(at, { type: "stepInline", direction: 1, word: false, extend: true });
    expect(selection(result.state)).toEqual({ anchor: 2, focus: 3 });
  });
});

describe("行送り", () => {
  it("行を移ると、元いた送り方向の位置を保つ", () => {
    const { state, run } = setup("あ".repeat(24));
    const at = { ...state, caret: { offset: 2, preferEnd: false } };
    const result = run(at, { type: "moveAcross", direction: 1, extend: false });
    expect(result.state.caret.offset).toBe(10);
    expect(result.state.goal).toBe(2);
  });

  it("ひと画面ぶんまとめて跨ぐ", () => {
    // 8 字で折り返して 5 行。1 画面 3 行
    const { state, run } = setup("あ".repeat(40), 3);
    const result = run(state, { type: "page", direction: 1, extend: false });
    expect(result.state.caret.offset).toBe(24);
  });

  it("行が足りなければ文末で止まる", () => {
    const { state, run } = setup("あ".repeat(40), 99);
    const result = run(state, { type: "page", direction: 1, extend: false });
    expect(result.state.caret.offset).toBe(40);
  });
});

describe("端へ飛ぶ", () => {
  it("行末は折り返した行の末尾", () => {
    const { state, run } = setup("あ".repeat(24));
    const at = { ...state, caret: { offset: 10, preferEnd: false } };
    const result = run(at, { type: "lineEdge", edge: "end", extend: false });
    expect(result.state.caret).toEqual({ offset: 16, preferEnd: true });
  });

  it("文末は preferEnd で前の行に着ける", () => {
    const { state, run } = setup("あいうえお");
    const result = run(state, { type: "docEdge", edge: "end", extend: false });
    expect(result.state.caret).toEqual({ offset: 5, preferEnd: true });
  });

  it("段落の頭に居るなら、前の段落の頭まで戻る", () => {
    const { state, run } = setup("あい\nうえ\nおか");
    const at = { ...state, caret: { offset: 3, preferEnd: false } };
    const result = run(at, { type: "paragraphEdge", direction: -1, extend: false });
    expect(result.state.caret.offset).toBe(0);
  });
});

describe("編集への振り分け", () => {
  it("打ち込めないなら本文を触らない", () => {
    const { state, run } = setup("あいうえお");
    const selected = setSelection(state, 0, 2).state;
    expect(run(selected, { type: "delete", direction: -1, word: false }, locked).changed).toBe(
      null,
    );
    expect(run(selected, { type: "insert", text: "×" }, locked).changed).toBe(null);
  });

  it("打ち込めなくても選択はできる", () => {
    const { state, run } = setup("あいうえお");
    const result = run(state, { type: "selectAll" }, locked);
    expect(result.changed).toBe("selection");
    expect(selection(result.state)).toEqual({ anchor: 0, focus: 5 });
  });

  it("戻せるものが無ければ何も動かない", () => {
    const { state, run } = setup("あいうえお");
    expect(run(state, { type: "undo" }).changed).toBe(null);

    const typed = run(state, { type: "insert", text: "か" }).state;
    const back = run(typed, { type: "undo" });
    expect(back.changed).toBe("edit");
    expect(back.state.text).toBe("あいうえお");
    expect(run(back.state, { type: "redo" }).state.text).toBe("かあいうえお");
  });
});
