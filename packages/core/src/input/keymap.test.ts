import { describe, expect, it } from "vitest";
import type { Command } from "../edit/command";
import type { WritingMode } from "../types";
import { commandFor, type KeyStroke, type Platform } from "./keymap";

type Mods = Partial<Omit<KeyStroke, "key">>;

function press(key: string, mods: Mods = {}) {
  return { key, ctrl: false, meta: false, shift: false, alt: false, ...mods };
}

const at =
  (platform: Platform, mode: WritingMode) =>
  (key: string, mods?: Mods): Command | null =>
    commandFor(press(key, mods), mode, platform);

/** macOS は ⌥ が語、⌘ が端。それ以外は Ctrl が語で、端は Home / End */
const macV = at("mac", "vertical-rl");
const macH = at("mac", "horizontal-tb");
const otherV = at("other", "vertical-rl");
const otherH = at("other", "horizontal-tb");

describe("矢印は画面で見た向きに割り当てる", () => {
  it("縦書きは ↑↓ がインライン方向、←→ がブロック方向", () => {
    expect(macV("ArrowDown")).toMatchObject({ type: "stepInline", direction: 1 });
    expect(macV("ArrowUp")).toMatchObject({ type: "stepInline", direction: -1 });
    expect(macV("ArrowLeft")).toMatchObject({ type: "moveAcross", direction: 1 });
    expect(macV("ArrowRight")).toMatchObject({ type: "moveAcross", direction: -1 });
  });

  it("横書きは ←→ がインライン方向、↑↓ がブロック方向", () => {
    expect(macH("ArrowRight")).toMatchObject({ type: "stepInline", direction: 1 });
    expect(macH("ArrowLeft")).toMatchObject({ type: "stepInline", direction: -1 });
    expect(macH("ArrowDown")).toMatchObject({ type: "moveAcross", direction: 1 });
    expect(macH("ArrowUp")).toMatchObject({ type: "moveAcross", direction: -1 });
  });

  it("縦書きの左は、横書きの下と同じ「次の行」", () => {
    expect(macV("ArrowLeft")).toEqual(macH("ArrowDown"));
    expect(macV("ArrowRight")).toEqual(macH("ArrowUp"));
    expect(macV("ArrowDown")).toEqual(macH("ArrowRight"));
  });

  it("向きは OS で変わらない", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(macV(key)).toEqual(otherV(key));
      expect(macH(key)).toEqual(otherH(key));
    }
  });
});

describe("shift", () => {
  it("どの移動でも伸ばすに変わる", () => {
    for (const key of ["ArrowDown", "ArrowLeft", "Home", "End", "PageUp", "PageDown"]) {
      expect(macV(key, { shift: true })).toMatchObject({ extend: true });
      expect(macV(key)).toMatchObject({ extend: false });
    }
  });
});

describe("macOS の修飾キー", () => {
  it("⌥ はインライン方向なら単語、ブロック方向なら段落", () => {
    expect(macV("ArrowDown", { alt: true })).toMatchObject({ type: "stepInline", word: true });
    expect(macV("ArrowLeft", { alt: true })).toMatchObject({ type: "paragraphEdge", direction: 1 });
  });

  it("⌘ はインライン方向なら行の端、ブロック方向なら本文の端", () => {
    expect(macV("ArrowDown", { meta: true })).toMatchObject({ type: "lineEdge", edge: "end" });
    expect(macV("ArrowUp", { meta: true })).toMatchObject({ type: "lineEdge", edge: "start" });
    expect(macV("ArrowLeft", { meta: true })).toMatchObject({ type: "docEdge", edge: "end" });
    expect(macV("ArrowRight", { meta: true })).toMatchObject({ type: "docEdge", edge: "start" });
  });

  it("⌘ は ⌥ より強い", () => {
    expect(macV("ArrowDown", { meta: true, alt: true })).toMatchObject({ type: "lineEdge" });
    expect(macV("ArrowLeft", { meta: true, alt: true })).toMatchObject({ type: "docEdge" });
  });

  it("Ctrl + 矢印は受け持たない。OS が操作スペースの切り替えに使う", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(macV(key, { ctrl: true })).toBeNull();
    }
  });
});

describe("macOS 以外の修飾キー", () => {
  it("Ctrl はインライン方向なら単語、ブロック方向なら段落", () => {
    expect(otherV("ArrowDown", { ctrl: true })).toMatchObject({ type: "stepInline", word: true });
    expect(otherV("ArrowLeft", { ctrl: true })).toMatchObject({
      type: "paragraphEdge",
      direction: 1,
    });
  });

  it("矢印では本文の端へ飛べない。Ctrl + Home / End が担う", () => {
    expect(otherV("ArrowDown", { ctrl: true })).not.toMatchObject({ type: "lineEdge" });
    expect(otherV("Home", { ctrl: true })).toMatchObject({ type: "docEdge", edge: "start" });
    expect(otherV("End", { ctrl: true })).toMatchObject({ type: "docEdge", edge: "end" });
    expect(otherV("Home")).toMatchObject({ type: "lineEdge", edge: "start" });
    expect(otherV("End")).toMatchObject({ type: "lineEdge", edge: "end" });
  });

  it("Alt + 矢印は受け持たない。ブラウザの戻る / 進むを潰さない", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(otherV(key, { alt: true })).toBeNull();
    }
  });
});

describe("編集", () => {
  it("Backspace は手前、Delete は先を消す", () => {
    expect(macV("Backspace")).toEqual({ type: "delete", direction: -1, word: false });
    expect(macV("Delete")).toEqual({ type: "delete", direction: 1, word: false });
  });

  it("単語ぶん消すのは macOS が ⌥、それ以外は Ctrl", () => {
    expect(macV("Backspace", { alt: true })).toMatchObject({ word: true });
    expect(otherV("Backspace", { ctrl: true })).toMatchObject({ word: true });
    expect(macV("Backspace", { ctrl: true })).toMatchObject({ word: false });
    expect(otherV("Backspace", { alt: true })).toMatchObject({ word: false });
  });

  it("Enter は改行を入れる", () => {
    expect(macV("Enter")).toEqual({ type: "insert", text: "\n" });
  });

  it("組み方が変わっても編集キーは同じ", () => {
    for (const key of ["Backspace", "Delete", "Enter", "Home", "End"]) {
      expect(macV(key)).toEqual(macH(key));
    }
  });
});

describe("取り消しと全選択", () => {
  it("A は全選択、Z は戻す、shift+Z と Y は進む", () => {
    for (const on of [macV, otherV]) {
      expect(on("a", { meta: true })).toEqual({ type: "selectAll" });
      expect(on("z", { meta: true })).toEqual({ type: "undo" });
      expect(on("z", { meta: true, shift: true })).toEqual({ type: "redo" });
      expect(on("y", { meta: true })).toEqual({ type: "redo" });
    }
  });

  it("⌘ でも Ctrl でも受ける", () => {
    expect(macV("a", { ctrl: true })).toEqual({ type: "selectAll" });
    expect(otherV("a", { ctrl: true })).toEqual({ type: "selectAll" });
  });

  it("大文字でも同じ。shift を押すと key が大文字で来る", () => {
    expect(macV("A", { meta: true })).toEqual({ type: "selectAll" });
    expect(macV("Z", { meta: true, shift: true })).toEqual({ type: "redo" });
  });

  it("修飾が無ければ受け持たない。字はそのまま入力へ流す", () => {
    expect(macV("a")).toBeNull();
    expect(macV("z")).toBeNull();
  });
});

describe("受け持たないキー", () => {
  it("null を返す。preventDefault させないため", () => {
    for (const key of ["Escape", "Tab", "F5", "あ", "Shift"]) {
      expect(macV(key)).toBeNull();
    }
  });

  it("割り当ての無い字は素通し", () => {
    expect(macV("q", { meta: true })).toBeNull();
  });
});

describe("どの組み方でも軸の対応は保たれる", () => {
  it("矢印の 4 方向がすべて別のコマンドになる", () => {
    for (const platform of ["mac", "other"] as Platform[]) {
      for (const mode of ["vertical-rl", "horizontal-tb"] as WritingMode[]) {
        const seen = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((key) =>
          JSON.stringify(commandFor(press(key), mode, platform)),
        );
        expect(new Set(seen).size).toBe(4);
      }
    }
  });
});
