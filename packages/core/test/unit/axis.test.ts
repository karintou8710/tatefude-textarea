import { describe, expect, it } from "vitest";
import type { Rect } from "../../src/backend/dom/axis";
import * as axis from "../../src/backend/dom/axis";

/** 器は 200x100、画面の (10, 20) に置いてある */
const layer: Rect = { x: 10, y: 20, width: 200, height: 100 };
const surface: Rect = { x: 10, y: 20, width: 200, height: 100 };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe("縦書きと横書きで軸が入れ替わる", () => {
  describe("toClient", () => {
    it("縦書きは block が右端から左へ、inline が上から下へ伸びる", () => {
      expect(axis.toClient(true, 0, 0, layer)).toEqual({ x: 210, y: 20 });
      expect(axis.toClient(true, 30, 0, layer)).toEqual({ x: 180, y: 20 });
      expect(axis.toClient(true, 0, 40, layer)).toEqual({ x: 210, y: 60 });
    });

    it("横書きは block が上から下へ、inline が左から右へ伸びる", () => {
      expect(axis.toClient(false, 0, 0, layer)).toEqual({ x: 10, y: 20 });
      expect(axis.toClient(false, 30, 0, layer)).toEqual({ x: 10, y: 50 });
      expect(axis.toClient(false, 0, 40, layer)).toEqual({ x: 50, y: 20 });
    });
  });

  describe("blockOfRectInLayer", () => {
    it("縦書きは右端に置いた字が 0 行目の中心に来る", () => {
      // 幅 20 の字を右端に寄せると、中心は右端から 10
      expect(axis.blockOfRectInLayer(true, rect(190, 20, 20, 20), layer)).toBe(10);
    });

    it("横書きは上端に置いた字が 0 行目の中心に来る", () => {
      expect(axis.blockOfRectInLayer(false, rect(10, 20, 20, 20), layer)).toBe(10);
    });

    it("toClient と行き来できる", () => {
      for (const vertical of [true, false]) {
        const block = 37;
        const at = axis.toClient(vertical, block, 0, layer);
        // 厚みのない矩形を置き直せば、同じ block が返る
        expect(axis.blockOfRectInLayer(vertical, rect(at.x, at.y, 0, 0), layer)).toBeCloseTo(block);
      }
    });
  });

  describe("inline の始端と終端", () => {
    it("終端から始端を引くと、字が送り方向に占める長さになる", () => {
      const glyph = rect(60, 70, 18, 24);
      for (const vertical of [true, false]) {
        const start = axis.inlineStartOf(vertical, glyph, layer);
        const end = axis.inlineEndOf(vertical, glyph, layer);
        expect(end - start).toBe(axis.inlineSizeOf(vertical, glyph));
      }
    });

    it("縦書きは字の高さ、横書きは字の幅が送り量になる", () => {
      const glyph = rect(60, 70, 18, 24);
      expect(axis.inlineSizeOf(true, glyph)).toBe(24);
      expect(axis.inlineSizeOf(false, glyph)).toBe(18);
    });

    it("器の始端に置いた字は 0 から始まる", () => {
      expect(axis.inlineStartOf(true, rect(0, 20, 10, 10), layer)).toBe(0);
      expect(axis.inlineStartOf(false, rect(10, 0, 10, 10), layer)).toBe(0);
    });
  });

  it("layerLength は 1 行に入る長さ。縦書きは器の高さ", () => {
    expect(axis.layerLength(true, layer)).toBe(100);
    expect(axis.layerLength(false, layer)).toBe(200);
  });

  describe("キャレット矩形", () => {
    // 縦書きのキャレットは横棒。width が字の幅、height は 0
    const verticalCaret = rect(50, 80, 16, 0);
    // 横書きは縦棒
    const horizontalCaret = rect(50, 80, 0, 16);

    it("block は行を横切る向きの中心", () => {
      expect(axis.blockOfCaret(true, verticalCaret)).toBe(58);
      expect(axis.blockOfCaret(false, horizontalCaret)).toBe(88);
    });

    it("inline は送り方向の位置。厚みを持たない側をそのまま取る", () => {
      expect(axis.inlineOfCaret(true, verticalCaret)).toBe(80);
      expect(axis.inlineOfCaret(false, horizontalCaret)).toBe(50);
    });
  });

  describe("surface 基準 → layer 基準", () => {
    it("surface と layer が重なっていれば blockOfCaret と一致する", () => {
      const caret = rect(50, 80, 16, 0);
      const inLayer = axis.blockOfCaretInLayer(true, caret, layer, surface);
      // 縦書きは右端からの距離なので、器の幅から引いた形になる
      expect(inLayer).toBe(210 - (10 + 50 + 8));
    });

    it("surface がずれたぶんだけ inline も動く", () => {
      const shifted: Rect = { ...surface, x: 60, y: 90 };
      expect(axis.inlineInLayer(true, 0, layer, shifted)).toBe(90 - 20);
      expect(axis.inlineInLayer(false, 0, layer, shifted)).toBe(60 - 10);
    });
  });
});

describe("lineAt", () => {
  it("行送りで割った商が行番号", () => {
    expect(axis.lineAt(30, 0)).toBe(0);
    expect(axis.lineAt(30, 29.9)).toBe(0);
    expect(axis.lineAt(30, 30)).toBe(1);
    expect(axis.lineAt(30, 95)).toBe(3);
  });

  it("器の外を突いても 0 行目より手前へは行かない", () => {
    expect(axis.lineAt(30, -1)).toBe(0);
    expect(axis.lineAt(30, -1000)).toBe(0);
  });
});
