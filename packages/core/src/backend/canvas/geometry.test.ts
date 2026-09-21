import { describe, expect, it } from "vitest";
import { fakeMeasurer } from "../../../test/fakes/measurer";
import {
  caretGeometry,
  contentLength,
  type Geometry,
  lineIndexOfOffset,
  offsetFromPoint,
  selectionRects,
  toLogical,
  toPhysical,
  totalBreadth,
} from "./geometry";
import { layoutText } from "./layout";

const em = 10;
const measurer = fakeMeasurer(em);

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

// 行長 80px = 全角 8 文字
const layout = layoutText({
  text: "あいうえおかきくけこ",
  maxLineLength: contentLength(geometry),
  measurer,
  kinsoku: false,
});

describe("行の座標", () => {
  it("1 行目の右端がコンテナの右端に来る", () => {
    expect(toPhysical(geometry, 0, 0)).toEqual({ x: 190, y: 10 });
    expect(toPhysical(geometry, 1, 0)).toEqual({ x: 172, y: 10 });
  });

  it("送ったぶんだけ右へずれる", () => {
    expect(toPhysical({ ...geometry, scroll: 18 }, 1, 0).x).toBe(190);
  });

  it("行の中の位置は送り方向に進む", () => {
    expect(toPhysical(geometry, 0, 30)).toEqual({ x: 190, y: 40 });
  });

  it("物理座標から論理座標へ戻せる", () => {
    expect(toLogical(geometry, 190, 40)).toEqual({ block: 0, inline: 30 });
  });

  it("全部の行を並べるのに要る幅", () => {
    expect(totalBreadth(layout, geometry)).toBe(36);
  });
});

describe("横書き", () => {
  const horizontal: Geometry = { ...geometry, writingMode: "horizontal-tb" };

  it("軸が入れ替わる", () => {
    // 行の長さは幅、行送りは高さから取る
    expect(contentLength(horizontal)).toBe(180);
    expect(toPhysical(horizontal, 0, 0)).toEqual({ x: 10, y: 10 });
    expect(toPhysical(horizontal, 1, 30)).toEqual({ x: 40, y: 28 });
  });

  it("送ると上へずれる", () => {
    expect(toPhysical({ ...horizontal, scroll: 18 }, 1, 0).y).toBe(10);
  });

  it("物理座標から論理座標へ戻せる", () => {
    expect(toLogical(horizontal, 40, 28)).toEqual({ block: 18, inline: 30 });
  });
});

describe("キャレットの位置", () => {
  // ネイティブと同じで、長さは字の箱 (textBox 12) ぶん。行送り 18 との差 6 は
  // 行の両側に 3 ずつ空くので、行の右端 172 から 3 ずらしたところに立つ
  it("行の中を下へ進む", () => {
    expect(caretGeometry(layout, geometry, 0)).toEqual({ x: 175, y: 10, width: 12, height: 0 });
    expect(caretGeometry(layout, geometry, 3)).toEqual({ x: 175, y: 40, width: 12, height: 0 });
  });

  it("折り返しの境目は preferEnd で行が変わる", () => {
    expect(caretGeometry(layout, geometry, 8, false)).toMatchObject({ x: 157, y: 10 });
    expect(caretGeometry(layout, geometry, 8, true)).toMatchObject({ x: 175, y: 90 });
  });

  it("横書きでは縦棒になる", () => {
    const horizontal: Geometry = { ...geometry, writingMode: "horizontal-tb" };
    const flat = layoutText({
      text: "あいうえお",
      maxLineLength: contentLength(horizontal),
      measurer,
      kinsoku: false,
      writingMode: "horizontal-tb",
    });
    // 横書きの送りは fakeMeasurer の字幅 (em の半分)。縦棒の長さは字の箱ぶん
    expect(caretGeometry(flat, horizontal, 2)).toEqual({ x: 20, y: 13, width: 0, height: 12 });
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
    expect(offsetFromPoint(layout, geometry, 181, 10 + 26)).toEqual({ offset: 3, line: 0 });
  });

  it("ちょうど中点は手前に倒す", () => {
    // ブラウザの当たり判定がそうなっている。dom バックエンドと揃える
    expect(offsetFromPoint(layout, geometry, 181, 10 + 25)).toEqual({ offset: 2, line: 0 });
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
      // 矩形は行の真ん中に立つので、行を引くには中心を使う
      const center = rect.x + rect.width / 2;
      expect(offsetFromPoint(layout, geometry, center, rect.y + 1).offset).toBe(offset);
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
