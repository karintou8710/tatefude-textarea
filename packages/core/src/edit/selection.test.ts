import { describe, expect, it } from "vitest";
import { newEditState } from "../state/edit";
import { range, selectedText, selection } from "../state/query";
import {
  grabHandle,
  moveCaret,
  selectAll,
  selectParagraph,
  selectWord,
  setSelection,
} from "./selection";

describe("選択の持ち方", () => {
  it("掴んだ側と動く側で持ち、range は前後に揃える", () => {
    const state = setSelection(newEditState("吾輩は猫である"), 5, 2).state;
    expect(selection(state)).toEqual({ anchor: 5, head: 2 });
    expect(range(state)).toEqual([2, 5]);
    expect(selectedText(state)).toBe("は猫で");
  });

  it("本文の外は端に丸める", () => {
    const state = setSelection(newEditState("あいう"), -5, 99).state;
    expect(selection(state)).toEqual({ anchor: 0, head: 3 });
  });

  it("元の state は書き換わらない", () => {
    const before = newEditState("あいう");
    setSelection(before, 1, 3);
    expect(selection(before)).toEqual({ anchor: 0, head: 0 });
  });

  it("全部選ぶ", () => {
    const state = selectAll(newEditState("あいう")).state;
    expect(selection(state)).toEqual({ anchor: 0, head: 3 });
  });
});

describe("キャレットを動かす", () => {
  it("extend でないと掴んだ側も動く", () => {
    const start = setSelection(newEditState("あいうえお"), 1).state;
    const extended = moveCaret(start, { offset: 3, preferEnd: false }, true).state;
    expect(selection(extended)).toEqual({ anchor: 1, head: 3 });

    const moved = moveCaret(extended, { offset: 4, preferEnd: false }, false).state;
    expect(selection(moved)).toEqual({ anchor: 4, head: 4 });
  });

  it("行を跨ぐ狙いを持ち歩く", () => {
    const state = moveCaret(
      newEditState("あいう"),
      { offset: 1, preferEnd: false },
      false,
      7,
    ).state;
    expect(state.goal).toBe(7);
    // 狙いを渡さなければ消える
    expect(moveCaret(state, { offset: 2, preferEnd: false }, false).state.goal).toBe(null);
  });
});

describe("まとまりで選ぶ", () => {
  it("語を選ぶ", () => {
    const result = selectWord(newEditState("今日はいい天気"), 1);
    expect(result.changed).toBe("selection");
    expect(selection(result.state)).toEqual({ anchor: 0, head: 2 });
  });

  it("段落を選ぶ。改行は含めない", () => {
    const state = selectParagraph(newEditState("あい\nうえ"), 4).state;
    expect(selectedText(state)).toBe("うえ");
  });

  it("ハンドルを掴むと、掴んだ側が focus になる", () => {
    const selected = setSelection(newEditState("あいうえお"), 1, 4).state;
    expect(selection(grabHandle(selected, "start").state)).toEqual({ anchor: 4, head: 1 });
    expect(selection(grabHandle(selected, "end").state)).toEqual({ anchor: 1, head: 4 });
  });
});
