import type { Measurer } from "../src/layout/measure";
import type { Orientation } from "../src/text/char-class";

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
