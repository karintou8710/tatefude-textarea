import { describe, expect, it } from "vitest";
import { segmentGraphemes, stepGrapheme, stepWord } from "../../src/text/segment";

describe("segmentGraphemes", () => {
  it("元テキストのオフセットを付ける", () => {
    expect(segmentGraphemes("あい", 5)).toEqual([
      { text: "あ", start: 5, end: 6 },
      { text: "い", start: 6, end: 7 },
    ]);
  });

  it("サロゲートペアを割らない", () => {
    expect(segmentGraphemes("𠮷野").map((g) => g.text)).toEqual(["𠮷", "野"]);
  });

  it("結合した絵文字をひとかたまりにする", () => {
    expect(segmentGraphemes("👨‍👩‍👦あ").map((g) => g.text)).toEqual(["👨‍👩‍👦", "あ"]);
  });
});

describe("stepGrapheme", () => {
  it("結合列をまたいで動く", () => {
    const text = "a👨‍👩‍👦b";
    const afterFamily = stepGrapheme(text, 1, 1);
    expect(afterFamily).toBe(text.length - 1);
    expect(stepGrapheme(text, afterFamily, -1)).toBe(1);
  });

  it("端では止まる", () => {
    expect(stepGrapheme("あい", 0, -1)).toBe(0);
    expect(stepGrapheme("あい", 2, 1)).toBe(2);
  });
});

describe("stepWord", () => {
  it("ラテン語の区切りで止まる", () => {
    const text = "hello world";
    expect(stepWord(text, 0, 1)).toBe(5);
    expect(stepWord(text, 11, -1)).toBe(6);
  });

  it("日本語は形態素の境目で止まる", () => {
    const text = "吾輩は猫である";
    expect(stepWord(text, 0, 1)).toBe(2);
  });
});
