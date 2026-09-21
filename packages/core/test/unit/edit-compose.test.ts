import { describe, expect, it } from "vitest";
import { beginComposition, endComposition, updateComposition } from "../../src/edit/compose";
import { setSelection } from "../../src/edit/selection";
import { reset } from "../../src/edit/text";
import { type EditState, type Limits, newEditState } from "../../src/state/edit";
import { composing, displayCaret, viewContent } from "../../src/state/query";

const open: Limits = { editable: true, maxLength: Number.POSITIVE_INFINITY };
const locked: Limits = { editable: false, maxLength: Number.POSITIVE_INFINITY };

/** 「あお」の間で「かん」を変換している state */
function composingState(preedit = "かん", activeEnd = preedit.length): EditState {
  const at = setSelection(newEditState("あお"), 1).state;
  const begun = beginComposition(at, open).state;
  return updateComposition(begun, preedit, 0, activeEnd).state;
}

describe("変換中", () => {
  it("確定するまで本文には入らない。表示にだけ混ざる", () => {
    const state = composingState();
    expect(state.text).toBe("あお");
    expect(viewContent(state).text).toBe("あかんお");
    expect(composing(state)).toBe(true);
  });

  it("始めた直後は預かった字が無いので、下線も引かない", () => {
    const at = setSelection(newEditState("あお"), 1).state;
    const result = beginComposition(at, open);
    expect(result.changed).toBe("view");
    expect(composing(result.state)).toBe(true);
    expect(viewContent(result.state).composition).toBe(null);
  });

  it("文節は表示用テキストの上の位置で返す", () => {
    const state = composingState("かんじへんかん", 5);
    expect(viewContent(state).composition).toEqual({
      start: 1,
      end: 8,
      activeStart: 1,
      activeEnd: 6,
    });
  });

  it("キャレットは IME がいま見ている文節の末尾に置く", () => {
    expect(displayCaret(composingState("かんじ", 2))).toEqual({ offset: 3, preferEnd: true });
  });

  it("選択の上から始めると、まず選択が消える", () => {
    const selected = setSelection(newEditState("あいうえお"), 1, 3).state;
    const result = beginComposition(selected, open);
    expect(result.changed).toBe("edit");
    expect(result.state.text).toBe("あえお");
    expect(composing(result.state)).toBe(true);
  });

  it("打ち込めないなら始まらない", () => {
    const before = newEditState("あお");
    const result = beginComposition(before, locked);
    expect(result.changed).toBe(null);
    expect(result.state).toBe(before);
  });
});

describe("変換の終わり", () => {
  it("確定した字が本文に入る", () => {
    const result = endComposition(composingState(), "漢", open);
    expect(result.changed).toBe("edit");
    expect(result.state.text).toBe("あ漢お");
    expect(composing(result.state)).toBe(false);
  });

  it("文頭で始めた変換も確定できる", () => {
    const begun = beginComposition(newEditState("あお"), open).state;
    const state = updateComposition(begun, "か", 0, 1).state;
    expect(endComposition(state, "下", open).state.text).toBe("下あお");
  });

  it("何も確定せずに終わったら、描き直すだけ", () => {
    const result = endComposition(composingState(), "", open);
    expect(result.changed).toBe("view");
    expect(result.state.text).toBe("あお");
    expect(viewContent(result.state).text).toBe("あお");
  });

  it("変換していないときの更新と終了は届かない", () => {
    const before = newEditState("あお");
    expect(updateComposition(before, "かん", 0, 2).changed).toBe(null);
    expect(endComposition(before, "漢", open).changed).toBe(null);
  });

  it("本文を入れ替えられたら、預かっていた字は消える", () => {
    const state = reset(composingState(), "さしすせそ").state;
    expect(composing(state)).toBe(false);
    expect(viewContent(state).text).toBe("さしすせそ");
  });

  it("元の state は書き換わらない", () => {
    const before = composingState();
    endComposition(before, "漢", open);
    expect(composing(before)).toBe(true);
    expect(before.text).toBe("あお");
  });
});
