import type { Command } from "../edit/command";
import type { WritingMode } from "../types";

/** 字の並ぶ向き (inline) か、行の重なる向き (block) か */
export type Axis = "inline" | "block";

/** キー割り当てが分かれる単位。macOS だけが別 */
export type Platform = "mac" | "other";

/** KeyboardEvent から、割り当てに要るものだけ取り出した形 */
export interface KeyStroke {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export function strokeOf(event: KeyboardEvent): KeyStroke {
  return {
    key: event.key,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

/**
 * 押されたキーを、やることへ移す。null なら受け持たない (既定の動作に任せる)。
 *
 * **修飾キーはその OS のネイティブに揃える。**同じ「単語ぶん動く」でも、
 * macOS は ⌥ から、それ以外は Ctrl から来る。キーは OS ごとに入り口が違うので、
 * ここは揃えずに分ける (矢印の向きは逆で、画面の向きで揃える)。
 *
 * 迷ったら test/native.browser.test.ts に本物を並べて測る。
 */
export function commandFor(
  stroke: KeyStroke,
  writingMode: WritingMode,
  platform: Platform,
): Command | null {
  const { key, shift } = stroke;
  const mac = platform === "mac";
  /** 取り消し・全選択。macOS の ⌘ と、それ以外の Ctrl。どちらでも受ける */
  const mod = stroke.meta || stroke.ctrl;
  /** 語・段落ぶん動く。macOS は ⌥、それ以外は Ctrl */
  const byUnit = mac ? stroke.alt : stroke.ctrl;
  /** 端まで飛ぶ。macOS だけが矢印で飛び、それ以外は Home / End が担う */
  const toEdge = mac && stroke.meta;

  const arrow = arrowOf(key, writingMode);
  if (arrow) {
    // その OS では矢印に割り当ての無い修飾。ブラウザか OS の側が持っている
    // (Windows の Alt + ← は戻る、macOS の Ctrl + ← は操作スペースの切り替え)
    if (mac ? stroke.ctrl : stroke.alt || stroke.meta) return null;
    const { axis, direction } = arrow;
    if (axis === "inline") {
      if (toEdge) return { type: "lineEdge", edge: edgeOf(direction), extend: shift };
      return { type: "stepInline", direction, word: byUnit, extend: shift };
    }
    if (toEdge) return { type: "docEdge", edge: edgeOf(direction), extend: shift };
    if (byUnit) return { type: "paragraphEdge", direction, extend: shift };
    return { type: "moveAcross", direction, extend: shift };
  }

  switch (key) {
    // Blink は縦書きだと何もしないが、使えないままにする理由が無い。
    // mod を足すと本文の端まで——macOS 以外は、ここでしか文頭・文末へ行けない
    case "Home":
      return mod
        ? { type: "docEdge", edge: "start", extend: shift }
        : { type: "lineEdge", edge: "start", extend: shift };
    case "End":
      return mod
        ? { type: "docEdge", edge: "end", extend: shift }
        : { type: "lineEdge", edge: "end", extend: shift };
    case "PageDown":
      return { type: "page", direction: 1, extend: shift };
    case "PageUp":
      return { type: "page", direction: -1, extend: shift };
    case "Backspace":
      return { type: "delete", direction: -1, word: byUnit };
    case "Delete":
      return { type: "delete", direction: 1, word: byUnit };
    case "Enter":
      return { type: "insert", text: "\n" };
    default:
      break;
  }

  if (!mod) return null;
  switch (key.toLowerCase()) {
    case "a":
      return { type: "selectAll" };
    case "z":
      return shift ? { type: "redo" } : { type: "undo" };
    case "y":
      return { type: "redo" };
    default:
      return null;
  }
}

/**
 * 矢印キーを、画面で見た向きのまま軸に割り当てる。
 * 縦書きは字が下へ並び行が左へ重なるので、インライン方向が ↑↓・ブロック方向が ←→ になる。
 * (ネイティブの textarea は縦書きでも ←→ がインライン方向のままで、そこだけ合わせていない)
 */
function arrowOf(key: string, writingMode: WritingMode): { axis: Axis; direction: 1 | -1 } | null {
  const vertical = writingMode === "vertical-rl";
  switch (key) {
    case "ArrowDown":
      return vertical ? { axis: "inline", direction: 1 } : { axis: "block", direction: 1 };
    case "ArrowUp":
      return vertical ? { axis: "inline", direction: -1 } : { axis: "block", direction: -1 };
    case "ArrowLeft":
      return vertical ? { axis: "block", direction: 1 } : { axis: "inline", direction: -1 };
    case "ArrowRight":
      return vertical ? { axis: "block", direction: -1 } : { axis: "inline", direction: 1 };
    default:
      return null;
  }
}

function edgeOf(direction: 1 | -1): "start" | "end" {
  return direction === 1 ? "end" : "start";
}
