import { stepGrapheme, stepWord } from "../text/segment";

/**
 * キャレットの位置と、折り返しの境目でどちら側の行に着けるか。
 * 前の行の末尾と次の行の先頭は同じ offset になるので preferEnd で区別する。
 */
export interface Caret {
  offset: number;
  preferEnd: boolean;
}

/** 行を跨いで動くときに保つ「元いた送り方向の位置」 */
export type Goal = number | null;

/** 行の中を進む / 戻る。縦書きでは下 / 上 */
export function moveInline(text: string, caret: Caret, direction: 1 | -1, byWord: boolean): Caret {
  const offset = byWord
    ? stepWord(text, caret.offset, direction)
    : stepGrapheme(text, caret.offset, direction);
  // 字を送って着いた境目は、行き帰りとも次の行の先頭に見せる。
  // 前の行の末尾に出るのは行末へ飛んだときと、行の外を突いたときだけ (Blink も同じ)
  return { offset, preferEnd: false };
}
