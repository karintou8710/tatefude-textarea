import { describe, expect, it } from "vitest";
import { paragraphEdge } from "./move";
import { paragraphRangeAt, wordRangeAt } from "./range";

describe("語", () => {
  it("クリックした場所に乗っている語を取る", () => {
    expect(wordRangeAt("今日はいい天気", 1)).toEqual([0, 2]);
  });

  it("語の境目では後ろの語を取る", () => {
    expect(wordRangeAt("hello world", 5)).toEqual([5, 6]);
  });
});

describe("段落", () => {
  const text = "あい\nうえ\nおか";

  it("改行で挟まれた範囲を取る。改行は含めない", () => {
    expect(paragraphRangeAt(text, 4)).toEqual([3, 5]);
  });

  it("最後の段落は文末まで", () => {
    expect(paragraphRangeAt(text, 7)).toEqual([6, 8]);
  });

  it("段落の頭へ。すでに頭に居るなら前の段落まで戻る", () => {
    expect(paragraphEdge(text, 4, -1)).toEqual({ offset: 3, preferEnd: false });
    expect(paragraphEdge(text, 3, -1)).toEqual({ offset: 0, preferEnd: false });
  });

  it("段落の末へ。すでに末に居るなら次の段落まで進む", () => {
    expect(paragraphEdge(text, 4, 1)).toEqual({ offset: 5, preferEnd: true });
    expect(paragraphEdge(text, 5, 1)).toEqual({ offset: 8, preferEnd: true });
  });
});
