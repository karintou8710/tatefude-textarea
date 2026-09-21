import type { Orientation } from "../../src/backend/canvas/char-class";
import type { Measurer } from "../../src/backend/canvas/measure";

/**
 * 実フォントを使わずにレイアウトを回すための計測器。
 * 全角は 1em、横倒しにする字は半角ぶんの 0.5em として扱う。
 */
export function fakeMeasurer(em = 10): Measurer {
  return {
    em,
    width: (text: string) => text.length * em * 0.5,
    advance: (text: string, orientation: Orientation) =>
      orientation === "rotate" ? text.length * em * 0.5 : em,
  };
}
