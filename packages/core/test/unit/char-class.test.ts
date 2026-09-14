import { describe, expect, it } from "vitest";
import {
  isLineEndForbidden,
  isLineStartForbidden,
  isSmallKana,
  orientationOf,
} from "../../src/backend/canvas/char-class";

describe("orientationOf", () => {
  it("漢字と仮名は正立する", () => {
    for (const ch of "吾輩は猫である") expect(orientationOf(ch)).toBe("upright");
  });

  it("ラテン文字と数字は横倒しにする", () => {
    for (const ch of "Abc123") expect(orientationOf(ch)).toBe("rotate");
  });

  it("括弧と長音は横倒しにする", () => {
    for (const ch of "「」（）ー〜…") expect(orientationOf(ch)).toBe("rotate");
  });

  it("句読点は字面を右上へ寄せる", () => {
    for (const ch of "、。") expect(orientationOf(ch)).toBe("corner");
  });

  it("全角英数は正立する", () => {
    expect(orientationOf("Ａ")).toBe("upright");
    expect(orientationOf("１")).toBe("upright");
  });
});

describe("禁則の判定", () => {
  it("句読点と閉じ括弧は行頭に置けない", () => {
    for (const ch of "、。」）！？っゃ") expect(isLineStartForbidden(ch)).toBe(true);
    expect(isLineStartForbidden("猫")).toBe(false);
  });

  it("開き括弧は行末に置けない", () => {
    for (const ch of "「（【") expect(isLineEndForbidden(ch)).toBe(true);
    expect(isLineEndForbidden("」")).toBe(false);
  });
});

describe("isSmallKana", () => {
  it("小書き仮名だけを拾う", () => {
    expect(isSmallKana("っ")).toBe(true);
    expect(isSmallKana("ョ")).toBe(true);
    expect(isSmallKana("つ")).toBe(false);
  });
});
