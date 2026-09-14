import type { WritingMode } from "../types";

/** 字の並ぶ向き (inline) か、行の重なる向き (block) か */
export type Axis = "inline" | "block";

/**
 * キーを押した結果やること。何をどう動かすかだけで、動かし方は持たない。
 * こうしておくと「どのキーが何をするか」を node のテストで縛れる。
 */
export type Command =
  | { type: "stepInline"; direction: 1 | -1; word: boolean; extend: boolean }
  | { type: "lineEdge"; edge: "start" | "end"; extend: boolean }
  | { type: "docEdge"; edge: "start" | "end"; extend: boolean }
  | { type: "paragraphEdge"; direction: 1 | -1; extend: boolean }
  | { type: "moveAcross"; direction: 1 | -1; extend: boolean }
  | { type: "page"; direction: 1 | -1; extend: boolean }
  | { type: "delete"; direction: 1 | -1; word: boolean }
  | { type: "insert"; text: string }
  | { type: "selectAll" }
  | { type: "undo" }
  | { type: "redo" };

/** KeyboardEvent から、割り当てに要るものだけ取り出した形 */
export interface KeyStroke {
  key: string;
  /** macOS の ⌘ と、それ以外の Ctrl */
  accel: boolean;
  shift: boolean;
  alt: boolean;
}

export function strokeOf(event: KeyboardEvent): KeyStroke {
  return {
    key: event.key,
    accel: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

/**
 * 押されたキーを、やることへ移す。null なら受け持たない (既定の動作に任せる)。
 *
 * 矢印以外は Blink の textarea を基準にしている。迷ったら
 * test/browser/native.test.ts に本物を並べて測る。
 */
export function commandFor(stroke: KeyStroke, writingMode: WritingMode): Command | null {
  const { key, accel, shift, alt } = stroke;

  const arrow = arrowOf(key, writingMode);
  if (arrow) {
    const { axis, direction } = arrow;
    if (axis === "inline") {
      // 字送りの向きに accel を足すと、行の端まで
      if (accel) return { type: "lineEdge", edge: edgeOf(direction), extend: shift };
      return { type: "stepInline", direction, word: alt, extend: shift };
    }
    // 行送りの向きに accel を足すと、本文の端まで
    if (accel) return { type: "docEdge", edge: edgeOf(direction), extend: shift };
    if (alt) return { type: "paragraphEdge", direction, extend: shift };
    return { type: "moveAcross", direction, extend: shift };
  }

  switch (key) {
    // Blink は縦書きだと何もしないが、使えないままにする理由が無い
    case "Home":
      return { type: "lineEdge", edge: "start", extend: shift };
    case "End":
      return { type: "lineEdge", edge: "end", extend: shift };
    case "PageDown":
      return { type: "page", direction: 1, extend: shift };
    case "PageUp":
      return { type: "page", direction: -1, extend: shift };
    case "Backspace":
      return { type: "delete", direction: -1, word: alt };
    case "Delete":
      return { type: "delete", direction: 1, word: alt };
    case "Enter":
      return { type: "insert", text: "\n" };
    default:
      break;
  }

  if (!accel) return null;
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
 * 縦書きは字が下へ並び行が左へ重なるので、字送りが ↑↓・行送りが ←→ になる。
 * (ネイティブの textarea は縦書きでも ←→ が字送りのままで、そこだけ合わせていない)
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
