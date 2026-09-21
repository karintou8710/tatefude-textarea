import { describe, expect, it } from "vitest";
import type { Command } from "../../src/edit/command";
import { commandFor, type KeyStroke } from "../../src/input/keymap";
import type { WritingMode } from "../../src/types";

function press(key: string, mods: Partial<Omit<KeyStroke, "key">> = {}) {
  return { key, accel: false, shift: false, alt: false, ...mods };
}

const vertical = (key: string, mods?: Partial<Omit<KeyStroke, "key">>): Command | null =>
  commandFor(press(key, mods), "vertical-rl");
const horizontal = (key: string, mods?: Partial<Omit<KeyStroke, "key">>): Command | null =>
  commandFor(press(key, mods), "horizontal-tb");

describe("矢印は画面で見た向きに割り当てる", () => {
  it("縦書きは ↑↓ が字送り、←→ が行送り", () => {
    expect(vertical("ArrowDown")).toMatchObject({ type: "stepInline", direction: 1 });
    expect(vertical("ArrowUp")).toMatchObject({ type: "stepInline", direction: -1 });
    expect(vertical("ArrowLeft")).toMatchObject({ type: "moveAcross", direction: 1 });
    expect(vertical("ArrowRight")).toMatchObject({ type: "moveAcross", direction: -1 });
  });

  it("横書きは ←→ が字送り、↑↓ が行送り", () => {
    expect(horizontal("ArrowRight")).toMatchObject({ type: "stepInline", direction: 1 });
    expect(horizontal("ArrowLeft")).toMatchObject({ type: "stepInline", direction: -1 });
    expect(horizontal("ArrowDown")).toMatchObject({ type: "moveAcross", direction: 1 });
    expect(horizontal("ArrowUp")).toMatchObject({ type: "moveAcross", direction: -1 });
  });

  it("縦書きの左は、横書きの下と同じ「次の行」", () => {
    expect(vertical("ArrowLeft")).toEqual(horizontal("ArrowDown"));
    expect(vertical("ArrowRight")).toEqual(horizontal("ArrowUp"));
    expect(vertical("ArrowDown")).toEqual(horizontal("ArrowRight"));
  });
});

describe("修飾キー", () => {
  it("shift はどの移動でも伸ばすに変わる", () => {
    for (const key of ["ArrowDown", "ArrowLeft", "Home", "End", "PageUp", "PageDown"]) {
      expect(vertical(key, { shift: true })).toMatchObject({ extend: true });
      expect(vertical(key)).toMatchObject({ extend: false });
    }
  });

  it("字送り + accel は行の端へ", () => {
    expect(vertical("ArrowDown", { accel: true })).toMatchObject({
      type: "lineEdge",
      edge: "end",
    });
    expect(vertical("ArrowUp", { accel: true })).toMatchObject({
      type: "lineEdge",
      edge: "start",
    });
  });

  it("行送り + accel は本文の端へ", () => {
    expect(vertical("ArrowLeft", { accel: true })).toMatchObject({
      type: "docEdge",
      edge: "end",
    });
    expect(vertical("ArrowRight", { accel: true })).toMatchObject({
      type: "docEdge",
      edge: "start",
    });
  });

  it("alt は字送りなら単語、行送りなら段落", () => {
    expect(vertical("ArrowDown", { alt: true })).toMatchObject({
      type: "stepInline",
      word: true,
    });
    expect(vertical("ArrowLeft", { alt: true })).toMatchObject({
      type: "paragraphEdge",
      direction: 1,
    });
  });

  it("accel は alt より強い", () => {
    expect(vertical("ArrowDown", { accel: true, alt: true })).toMatchObject({ type: "lineEdge" });
    expect(vertical("ArrowLeft", { accel: true, alt: true })).toMatchObject({ type: "docEdge" });
  });
});

describe("編集", () => {
  it("Backspace は手前、Delete は先を消す", () => {
    expect(vertical("Backspace")).toEqual({ type: "delete", direction: -1, word: false });
    expect(vertical("Delete")).toEqual({ type: "delete", direction: 1, word: false });
  });

  it("alt を足すと単語ぶん", () => {
    expect(vertical("Backspace", { alt: true })).toMatchObject({ word: true });
  });

  it("Enter は改行を入れる", () => {
    expect(vertical("Enter")).toEqual({ type: "insert", text: "\n" });
  });

  it("組み方が変わっても編集キーは同じ", () => {
    for (const key of ["Backspace", "Delete", "Enter", "Home", "End"]) {
      expect(vertical(key)).toEqual(horizontal(key));
    }
  });
});

describe("accel つきの割り当て", () => {
  it("A は全選択、Z は戻す、shift+Z と Y は進む", () => {
    expect(vertical("a", { accel: true })).toEqual({ type: "selectAll" });
    expect(vertical("z", { accel: true })).toEqual({ type: "undo" });
    expect(vertical("z", { accel: true, shift: true })).toEqual({ type: "redo" });
    expect(vertical("y", { accel: true })).toEqual({ type: "redo" });
  });

  it("大文字でも同じ。shift を押すと key が大文字で来る", () => {
    expect(vertical("A", { accel: true })).toEqual({ type: "selectAll" });
    expect(vertical("Z", { accel: true, shift: true })).toEqual({ type: "redo" });
  });

  it("accel が無ければ受け持たない。字はそのまま入力へ流す", () => {
    expect(vertical("a")).toBeNull();
    expect(vertical("z")).toBeNull();
  });
});

describe("受け持たないキー", () => {
  it("null を返す。preventDefault させないため", () => {
    for (const key of ["Escape", "Tab", "F5", "あ", "Shift"]) {
      expect(vertical(key)).toBeNull();
    }
  });

  it("accel + 割り当ての無い字も素通し", () => {
    expect(vertical("q", { accel: true })).toBeNull();
  });
});

describe("どの組み方でも軸の対応は保たれる", () => {
  const modes: WritingMode[] = ["vertical-rl", "horizontal-tb"];

  it("字送りの 4 方向がすべて別のコマンドになる", () => {
    for (const mode of modes) {
      const seen = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((key) =>
        JSON.stringify(commandFor(press(key), mode)),
      );
      expect(new Set(seen).size).toBe(4);
    }
  });
});
