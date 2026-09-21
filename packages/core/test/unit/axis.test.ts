import { describe, expect, it } from "vitest";
import type { Axis, Rect } from "../../src/backend/dom/axis";
import * as axis from "../../src/backend/dom/axis";

/** コンテナは 200x100、画面の (10, 20) に置いてある */
const layer: Rect = { x: 10, y: 20, width: 200, height: 100 };
const surface: Rect = { x: 10, y: 20, width: 200, height: 100 };

/** 向きだけ変えた軸。寸法は行送り 30・字の箱 16 で固定する */
function on(vertical: boolean, over: Partial<Axis> = {}): Axis {
  return { vertical, lineHeight: 30, fontBox: 16, layer, surface, ...over };
}

const vertical = on(true);
const horizontal = on(false);

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe("縦書きと横書きで軸が入れ替わる", () => {
  describe("toClient", () => {
    it("縦書きは block が右端から左へ、inline が上から下へ伸びる", () => {
      expect(axis.toClient(vertical, 0, 0)).toEqual({ x: 210, y: 20 });
      expect(axis.toClient(vertical, 30, 0)).toEqual({ x: 180, y: 20 });
      expect(axis.toClient(vertical, 0, 40)).toEqual({ x: 210, y: 60 });
    });

    it("横書きは block が上から下へ、inline が左から右へ伸びる", () => {
      expect(axis.toClient(horizontal, 0, 0)).toEqual({ x: 10, y: 20 });
      expect(axis.toClient(horizontal, 30, 0)).toEqual({ x: 10, y: 50 });
      expect(axis.toClient(horizontal, 0, 40)).toEqual({ x: 50, y: 20 });
    });
  });

  describe("blockOfRectInLayer", () => {
    it("縦書きは右端に置いた字が 0 行目の中心に来る", () => {
      // 幅 20 の字を右端に寄せると、中心は右端から 10
      expect(axis.blockOfRectInLayer(vertical, rect(190, 20, 20, 20))).toBe(10);
    });

    it("横書きは上端に置いた字が 0 行目の中心に来る", () => {
      expect(axis.blockOfRectInLayer(horizontal, rect(10, 20, 20, 20))).toBe(10);
    });

    it("toClient と行き来できる", () => {
      for (const a of [vertical, horizontal]) {
        const block = 37;
        const at = axis.toClient(a, block, 0);
        // 厚みのない矩形を置き直せば、同じ block が返る
        expect(axis.blockOfRectInLayer(a, rect(at.x, at.y, 0, 0))).toBeCloseTo(block);
      }
    });
  });

  describe("inline の始端と終端", () => {
    it("終端から始端を引くと、字が送り方向に占める長さになる", () => {
      const glyph = rect(60, 70, 18, 24);
      for (const a of [vertical, horizontal]) {
        const start = axis.inlineStartOf(a, glyph);
        const end = axis.inlineEndOf(a, glyph);
        expect(end - start).toBe(axis.inlineSizeOf(a, glyph));
      }
    });

    it("縦書きは字の高さ、横書きは字の幅が送り量になる", () => {
      const glyph = rect(60, 70, 18, 24);
      expect(axis.inlineSizeOf(vertical, glyph)).toBe(24);
      expect(axis.inlineSizeOf(horizontal, glyph)).toBe(18);
    });

    it("コンテナの始端に置いた字は 0 から始まる", () => {
      expect(axis.inlineStartOf(vertical, rect(0, 20, 10, 10))).toBe(0);
      expect(axis.inlineStartOf(horizontal, rect(10, 0, 10, 10))).toBe(0);
    });
  });

  it("layerLength は 1 行に入る長さ。縦書きはコンテナの高さ", () => {
    expect(axis.layerLength(vertical)).toBe(100);
    expect(axis.layerLength(horizontal)).toBe(200);
  });

  describe("キャレット矩形", () => {
    // 縦書きのキャレットは横棒。width が字の幅、height は 0
    const verticalCaret = rect(50, 80, 16, 0);
    // 横書きは縦棒
    const horizontalCaret = rect(50, 80, 0, 16);

    it("block は行を横切る向きの中心", () => {
      expect(axis.blockOfCaret(vertical, verticalCaret)).toBe(58);
      expect(axis.blockOfCaret(horizontal, horizontalCaret)).toBe(88);
    });

    it("inline は送り方向の位置。厚みを持たない側をそのまま取る", () => {
      expect(axis.inlineOfCaret(vertical, verticalCaret)).toBe(80);
      expect(axis.inlineOfCaret(horizontal, horizontalCaret)).toBe(50);
    });
  });

  describe("surface 基準 → layer 基準", () => {
    it("surface と layer が重なっていれば blockOfCaret と一致する", () => {
      const caret = rect(50, 80, 16, 0);
      const inLayer = axis.blockOfCaretInLayer(vertical, caret);
      // 縦書きは右端からの距離なので、コンテナの幅から引いた形になる
      expect(inLayer).toBe(210 - (10 + 50 + 8));
    });

    it("surface がずれたぶんだけ inline も動く", () => {
      const shifted: Rect = { ...surface, x: 60, y: 90 };
      expect(axis.inlineInLayer(on(true, { surface: shifted }), 0)).toBe(90 - 20);
      expect(axis.inlineInLayer(on(false, { surface: shifted }), 0)).toBe(60 - 10);
    });
  });

  describe("blockOfPoint", () => {
    it("突いた点を surface 基準の block 位置に直す。縦書きは x、横書きは y", () => {
      expect(axis.blockOfPoint(vertical, 100, 70)).toBe(90);
      expect(axis.blockOfPoint(horizontal, 100, 70)).toBe(50);
    });
  });
});

describe("lineAt", () => {
  it("行送りで割った商が行番号", () => {
    expect(axis.lineAt(vertical, 0)).toBe(0);
    expect(axis.lineAt(vertical, 29.9)).toBe(0);
    expect(axis.lineAt(vertical, 30)).toBe(1);
    expect(axis.lineAt(vertical, 95)).toBe(3);
  });

  it("コンテナの外を突いても 0 行目より手前へは行かない", () => {
    expect(axis.lineAt(vertical, -1)).toBe(0);
    expect(axis.lineAt(vertical, -1000)).toBe(0);
  });
});

describe("lineOfRect", () => {
  it("矩形の中心がどの行に落ちるか。行送りで割る", () => {
    // 縦書き: 右端から 10px (0 行目の中), 40px (1 行目の中)
    expect(axis.lineOfRect(vertical, rect(190, 20, 20, 20))).toBe(0);
    expect(axis.lineOfRect(vertical, rect(160, 20, 20, 20))).toBe(1);
    expect(axis.lineOfRect(horizontal, rect(10, 20, 20, 20))).toBe(0);
    expect(axis.lineOfRect(horizontal, rect(10, 50, 20, 20))).toBe(1);
  });
});
