import { describe, expect, it } from "vitest";
import {
  caretGeometry,
  contentLength,
  type Geometry,
  lineCenterX,
  lineIndexOfOffset,
  offsetFromPoint,
  selectionRects,
  totalBreadth,
} from "../../src/layout/geometry";
import { layoutText } from "../../src/layout/layout";
import { fakeMeasurer } from "../fake-measurer";

const em = 10;
const measurer = fakeMeasurer(em);

const geometry: Geometry = {
  width: 200,
  height: 100,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  lineHeight: 18,
  em,
  scroll: 0,
};

// 行長 80px = 全角 8 文字
const layout = layoutText({
  text: "あいうえおかきくけこ",
  maxLineLength: contentLength(geometry),
  measurer,
  kinsoku: false,
});

describe("行の座標", () => {
  it("1 行目が右端に来る", () => {
    expect(lineCenterX(geometry, 0)).toBe(181);
    expect(lineCenterX(geometry, 1)).toBe(163);
  });

  it("送った ぶんだけ右へずれる", () => {
    expect(lineCenterX({ ...geometry, scroll: 18 }, 1)).toBe(181);
  });

  it("全部の行を並べるのに要る幅", () => {
    expect(totalBreadth(layout, geometry)).toBe(36);
  });
});

describe("キャレットの位置", () => {
  it("行の中を下へ進む", () => {
    expect(caretGeometry(layout, geometry, 0)).toMatchObject({ line: 0, x: 181, y: 10 });
    expect(caretGeometry(layout, geometry, 3)).toMatchObject({ line: 0, x: 181, y: 40 });
  });

  it("折り返しの境目は preferEnd で行が変わる", () => {
    expect(caretGeometry(layout, geometry, 8, false)).toMatchObject({ line: 1, x: 163, y: 10 });
    expect(caretGeometry(layout, geometry, 8, true)).toMatchObject({ line: 0, x: 181, y: 90 });
  });

  it("改行のあとは次の行の頭で確定する", () => {
    const broken = layoutText({
      text: "あい\nうえ",
      maxLineLength: contentLength(geometry),
      measurer,
      kinsoku: false,
    });
    expect(lineIndexOfOffset(broken, 2, false)).toBe(0);
    expect(lineIndexOfOffset(broken, 3, false)).toBe(1);
  });
});

describe("座標からキャレットへ", () => {
  it("字の前半なら手前、後半なら次の位置になる", () => {
    expect(offsetFromPoint(layout, geometry, 181, 10 + 21)).toEqual({ offset: 2, line: 0 });
    expect(offsetFromPoint(layout, geometry, 181, 10 + 25)).toEqual({ offset: 3, line: 0 });
  });

  it("行の外を突いたら行末に寄せる", () => {
    expect(offsetFromPoint(layout, geometry, 163, 999)).toEqual({ offset: 10, line: 1 });
  });

  it("左に外れたら最後の行に寄せる", () => {
    expect(offsetFromPoint(layout, geometry, 0, 10).line).toBe(1);
  });

  it("キャレットの座標と往復する", () => {
    for (const offset of [0, 1, 5, 8, 9, 10]) {
      const rect = caretGeometry(layout, geometry, offset, true);
      expect(offsetFromPoint(layout, geometry, rect.x, rect.y + 1).offset).toBe(offset);
    }
  });
});

describe("選択範囲の矩形", () => {
  it("行をまたぐと行ごとに割れる", () => {
    const rects = selectionRects(layout, geometry, 6, 9);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: 172, y: 70, width: 18, height: 20 });
    expect(rects[1]).toMatchObject({ x: 154, y: 10, width: 18, height: 10 });
  });

  it("空の選択には何も出さない", () => {
    expect(selectionRects(layout, geometry, 4, 4)).toEqual([]);
  });

  it("改行だけの行も塗る", () => {
    const broken = layoutText({
      text: "あ\n\nい",
      maxLineLength: contentLength(geometry),
      measurer,
      kinsoku: false,
    });
    const rects = selectionRects(broken, geometry, 0, 4);
    expect(rects).toHaveLength(3);
    expect(rects[1].height).toBeCloseTo(4);
  });
});
