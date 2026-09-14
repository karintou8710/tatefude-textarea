import { describe, expect, it } from "vitest";
import { type Layout, layoutText } from "../../src/layout/layout";
import { fakeMeasurer } from "../fake-measurer";

const em = 10;
const measurer = fakeMeasurer(em);

function layout(text: string, chars: number, kinsoku = true): Layout {
  return { ...layoutText({ text, maxLineLength: chars * em, measurer, kinsoku }) };
}

function texts(result: Layout): string[] {
  return result.lines.map((line) => line.chars.map((ch) => ch.text).join(""));
}

describe("行の折り返し", () => {
  it("行長を超えたら次の行へ送る", () => {
    expect(texts(layout("あいうえおかきくけこ", 4, false))).toEqual([
      "あいうえ",
      "おかきく",
      "けこ",
    ]);
  });

  it("改行で行が変わる", () => {
    expect(texts(layout("あい\nうえお", 10))).toEqual(["あい", "うえお"]);
  });

  it("空の段落も 1 行ぶん残す", () => {
    const result = layout("あ\n\nい", 10);
    expect(texts(result)).toEqual(["あ", "", "い"]);
    expect(result.lines[1].start).toBe(2);
    expect(result.lines[1].end).toBe(2);
  });

  it("行長より大きい 1 文字でも置く", () => {
    expect(texts(layout("あいう", 0.5, false))).toEqual(["あ", "い", "う"]);
  });

  it("横倒しの字は半角ぶんしか送らない", () => {
    // 全角 4 文字ぶんの行長に、半角は 8 文字入る
    expect(texts(layout("abcdefghij", 4, false))).toEqual(["abcdefgh", "ij"]);
  });

  it("改行文字は行の範囲に含めない", () => {
    const result = layout("あい\nうえ", 10);
    expect(result.lines[0].end).toBe(2);
    expect(result.lines[1].start).toBe(3);
    expect(result.lines[0].hardBreak).toBe(true);
    expect(result.lines[1].hardBreak).toBe(false);
  });
});

describe("禁則処理", () => {
  it("句点を行頭に残さない", () => {
    // 禁則なしなら「あいうえ」「お。」に割れる
    expect(texts(layout("あいうえお。", 5, false))).toEqual(["あいうえお", "。"]);
    expect(texts(layout("あいうえお。", 5, true))).toEqual(["あいうえ", "お。"]);
  });

  it("閉じ括弧と句点が続いてもまとめて次の行へ送る", () => {
    expect(texts(layout("あいうえお」。", 5, false))).toEqual(["あいうえお", "」。"]);
    expect(texts(layout("あいうえお」。", 5, true))).toEqual(["あいうえ", "お」。"]);
  });

  it("開き括弧を行末に残さない", () => {
    expect(texts(layout("あいうえ「おかき", 5, false))).toEqual(["あいうえ「", "おかき"]);
    expect(texts(layout("あいうえ「おかき", 5, true))).toEqual(["あいうえ", "「おかき"]);
  });

  it("戻しすぎるくらいなら諦めてそのまま切る", () => {
    // 行が禁則文字だけで埋まっていたら、追い出す先がない
    const result = layout("あ。。。。。。。。", 4, true);
    expect(result.lines[0].chars.length).toBeGreaterThan(0);
    expect(result.lines.map((line) => line.chars.length).reduce((a, b) => a + b)).toBe(9);
  });

  it("ラテン語の綴りを途中で割らない", () => {
    // 半角 10 文字ぶんの行長。"vertical" は途中で切れる位置に来る
    expect(texts(layout("あいうvertical text", 5, true))).toEqual(["あいう", "vertical ", "text"]);
  });

  it("1 行に収まらない綴りは諦めて割る", () => {
    expect(texts(layout("abcdefghij", 2, true))).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("文字の位置", () => {
  it("行の中の送り位置が積み上がる", () => {
    const line = layout("あいう", 10).lines[0];
    expect(line.chars.map((ch) => ch.offset)).toEqual([0, em, em * 2]);
    expect(line.length).toBe(em * 3);
  });

  it("元テキストのオフセットを持つ", () => {
    const line = layout("あい\nうえ", 10).lines[1];
    expect(line.chars.map((ch) => ch.start)).toEqual([3, 4]);
  });

  it("サロゲートペアを 1 文字として扱う", () => {
    const line = layout("𠮷野", 10).lines[0];
    expect(line.chars.map((ch) => ch.text)).toEqual(["𠮷", "野"]);
    expect(line.chars[1].start).toBe(2);
  });
});
