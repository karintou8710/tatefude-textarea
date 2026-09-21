import { describe, expect, it } from "vitest";
import { fakeMeasurer } from "../../../test/fakes/measurer";
import { moveInline } from "../../text/move";
import { contentLength, type Geometry } from "./geometry";
import { layoutText } from "./layout";
import { moveAcrossLines, moveToLineEdge } from "./movement";

const em = 10;
const geometry: Geometry = {
  writingMode: "vertical-rl",
  width: 200,
  height: 100,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  lineHeight: 18,
  em,
  // 字の箱は em より少し大きい。キャレットの長さがこれに従うことを見る
  textBox: 12,
  scroll: 0,
};

const text = "あいうえおかきくけこ";
// 8 文字で折り返す
const layout = layoutText({
  text,
  maxLineLength: contentLength(geometry),
  measurer: fakeMeasurer(em),
  kinsoku: false,
});

describe("行の中の移動", () => {
  it("進んで着いた境目は次の行の先頭に見せる", () => {
    expect(moveInline(text, { offset: 7, preferEnd: false }, 1, false)).toEqual({
      offset: 8,
      preferEnd: false,
    });
  });

  it("戻って着いた境目も次の行の先頭に見せる", () => {
    expect(moveInline(text, { offset: 9, preferEnd: false }, -1, false)).toEqual({
      offset: 8,
      preferEnd: false,
    });
  });

  it("端では止まる", () => {
    expect(moveInline(text, { offset: 0, preferEnd: false }, -1, false).offset).toBe(0);
    expect(moveInline(text, { offset: 10, preferEnd: true }, 1, false).offset).toBe(10);
  });
});

describe("行をまたぐ移動", () => {
  it("縦書きでは direction 1 が次の行 (左)", () => {
    const result = moveAcrossLines(layout, { offset: 3, preferEnd: false }, 1, null);
    // 2 行目は 2 文字しかないので行末で止まる
    expect(result.caret).toEqual({ offset: 10, preferEnd: true });
    expect(result.goal).toBe(30);
  });

  it("goal を持っていれば戻ったときに元の位置へ復す", () => {
    const away = moveAcrossLines(layout, { offset: 3, preferEnd: false }, 1, null);
    const back = moveAcrossLines(layout, away.caret, -1, away.goal);
    expect(back.caret.offset).toBe(3);
  });

  it("先頭の行から戻ると文頭で止まる", () => {
    expect(moveAcrossLines(layout, { offset: 3, preferEnd: false }, -1, null).caret.offset).toBe(0);
  });

  it("最後の行から進むと文末で止まる", () => {
    expect(moveAcrossLines(layout, { offset: 9, preferEnd: false }, 1, null).caret.offset).toBe(10);
  });
});

describe("行頭と行末", () => {
  it("いま居る行の端へ動く", () => {
    expect(moveToLineEdge(layout, { offset: 3, preferEnd: false }, "start").offset).toBe(0);
    expect(moveToLineEdge(layout, { offset: 3, preferEnd: false }, "end")).toEqual({
      offset: 8,
      preferEnd: true,
    });
  });
});
