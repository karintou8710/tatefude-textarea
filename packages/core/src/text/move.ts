import type { Caret } from "./caret";
import { stepGrapheme, stepWord } from "./segment";

/** キャレットを 1 つぶん動かす計算。状態は持たない */

/** 行の中を進む / 戻る。縦書きでは下 / 上 */
export function moveInline(text: string, caret: Caret, direction: 1 | -1, byWord: boolean): Caret {
  const offset = byWord
    ? stepWord(text, caret.offset, direction)
    : stepGrapheme(text, caret.offset, direction);
  // 字を送って着いた境目は、行き帰りとも次の行の先頭に見せる。
  // 前の行の末尾に出るのは行末へ飛んだときと、行の外をクリックしたときだけ (Blink も同じ)
  return { offset, preferEnd: false };
}

/** 段落の頭 / 末へ。すでに端に居るなら隣の段落まで行く */
export function paragraphEdge(text: string, at: number, direction: 1 | -1): Caret {
  if (direction === -1) {
    let start = text.lastIndexOf("\n", at - 1) + 1;
    if (start === at) start = text.lastIndexOf("\n", at - 2) + 1;
    return { offset: Math.max(0, start), preferEnd: false };
  }
  let end = text.indexOf("\n", at);
  if (end === at) end = text.indexOf("\n", at + 1);
  return { offset: end === -1 ? text.length : end, preferEnd: true };
}
