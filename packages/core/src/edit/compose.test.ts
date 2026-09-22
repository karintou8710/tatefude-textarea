import { describe, expect, it } from "vitest";
import { type EditState, type Limits, newEditState } from "../state/edit";
import { composing, viewContent } from "../state/query";
import { beginComposition, endComposition, updateComposition } from "./compose";
import { setSelection } from "./selection";
import { reset } from "./text";

const open: Limits = { editable: true, maxLength: Number.POSITIVE_INFINITY };
const locked: Limits = { editable: false, maxLength: Number.POSITIVE_INFINITY };

/** 「あお」の間で「かん」を変換している state */
function composingState(preedit = "かん", activeEnd = preedit.length): EditState {
  const at = setSelection(newEditState("あお"), 1).state;
  const begun = beginComposition(at, open).state;
  return updateComposition(begun, preedit, 0, activeEnd, open).state;
}

describe("変換中", () => {
  it("変換中の字も本文に入る", () => {
    const state = composingState();
    expect(state.text).toBe("あかんお");
    expect(viewContent(state).text).toBe("あかんお");
    expect(composing(state)).toBe(true);
  });

  it("始めた直後は字が無いので、下線も引かない", () => {
    const at = setSelection(newEditState("あお"), 1).state;
    const result = beginComposition(at, open);
    expect(result.changed).toBe("view");
    expect(composing(result.state)).toBe(true);
    expect(result.state.text).toBe("あお");
    expect(viewContent(result.state).composition).toBe(null);
  });

  it("下線を引く範囲と文節を本文の位置で返す", () => {
    const state = composingState("かんじへんかん", 5);
    expect(viewContent(state).composition).toEqual({
      start: 1,
      end: 8,
      activeStart: 1,
      activeEnd: 6,
    });
  });

  it("キャレットは IME がいま見ている文節の末尾に置く", () => {
    const state = composingState("かんじ", 2);
    expect(state.head).toEqual({ offset: 3, preferEnd: true });
    expect(state.anchor).toBe(3);
  });

  it("字が変わると、入っていた範囲を差し替える", () => {
    const state = updateComposition(composingState("かん"), "漢字", 0, 2, open).state;
    expect(state.text).toBe("あ漢字お");
    expect(viewContent(state).composition).toMatchObject({ start: 1, end: 3 });
  });

  it("続けて変換しても、undo は 1 回で変換の前に戻る", () => {
    // 700ms のまとまりに乗るので、更新ごとに積んでも 1 つにまとまる
    const state = updateComposition(composingState("か"), "かん", 0, 2, open).state;
    expect(state.history.past.length).toBe(1);
    expect(state.history.past[0].text).toBe("あお");
  });

  it("maxLength を超えるぶんは入らない", () => {
    const limits: Limits = { editable: true, maxLength: 3 };
    const at = setSelection(newEditState("あお"), 1).state;
    const begun = beginComposition(at, limits).state;
    const state = updateComposition(begun, "かんじ", 0, 3, limits).state;
    expect(state.text).toBe("あかお");
    expect(viewContent(state).composition).toMatchObject({ start: 1, end: 2 });
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
  it("確定した字に差し替わる", () => {
    const result = endComposition(composingState(), "漢", open);
    expect(result.changed).toBe("edit");
    expect(result.state.text).toBe("あ漢お");
    expect(composing(result.state)).toBe(false);
  });

  it("文頭で始めた変換も確定できる", () => {
    const begun = beginComposition(newEditState("あお"), open).state;
    const state = updateComposition(begun, "か", 0, 1, open).state;
    expect(endComposition(state, "下", open).state.text).toBe("下あお");
  });

  it("何も確定せずに終わったら、入っていた字が消える", () => {
    const result = endComposition(composingState(), "", open);
    expect(result.state.text).toBe("あお");
    expect(composing(result.state)).toBe(false);
  });

  it("変換していないときの更新と終了は届かない", () => {
    const before = newEditState("あお");
    expect(updateComposition(before, "かん", 0, 2, open).changed).toBe(null);
    expect(endComposition(before, "漢", open).changed).toBe(null);
  });

  it("本文を入れ替えられたら、変換の範囲も消える", () => {
    const state = reset(composingState(), "さしすせそ").state;
    expect(composing(state)).toBe(false);
    expect(viewContent(state).text).toBe("さしすせそ");
  });

  it("元の state は書き換わらない", () => {
    const before = composingState();
    endComposition(before, "漢", open);
    expect(composing(before)).toBe(true);
    expect(before.text).toBe("あかんお");
  });
});
