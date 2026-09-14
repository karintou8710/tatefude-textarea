import { lineIndexOfOffset, offsetAtLineDistance, offsetInLine } from "../layout/geometry";
import type { Layout } from "../layout/layout";
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

/** 行を移る。縦書きでは direction 1 が左 (次の行) */
export function moveAcrossLines(
  layout: Layout,
  caret: Caret,
  direction: 1 | -1,
  goal: Goal,
): { caret: Caret; goal: Goal } {
  const from = lineIndexOfOffset(layout, caret.offset, caret.preferEnd);
  const distance = goal ?? offsetInLine(layout.lines[from], caret.offset);
  const to = from + direction;

  if (to < 0) return { caret: { offset: layout.lines[0].start, preferEnd: false }, goal: distance };
  if (to >= layout.lines.length) {
    const last = layout.lines[layout.lines.length - 1];
    return { caret: { offset: last.end, preferEnd: true }, goal: distance };
  }

  const line = layout.lines[to];
  const offset = offsetAtLineDistance(line, distance);
  return {
    caret: { offset, preferEnd: offset === line.end && !line.hardBreak },
    goal: distance,
  };
}

/** 行頭 / 行末へ */
export function moveToLineEdge(layout: Layout, caret: Caret, edge: "start" | "end"): Caret {
  const index = lineIndexOfOffset(layout, caret.offset, caret.preferEnd);
  const line = layout.lines[index];
  if (edge === "start") return { offset: line.start, preferEnd: false };
  return { offset: line.end, preferEnd: true };
}

/** ひと画面ぶん行を移る */
export function movePage(
  layout: Layout,
  caret: Caret,
  direction: 1 | -1,
  linesPerPage: number,
  goal: Goal,
): { caret: Caret; goal: Goal } {
  let result = { caret, goal };
  for (let i = 0; i < Math.max(1, linesPerPage); i++) {
    result = moveAcrossLines(layout, result.caret, direction, result.goal);
  }
  return result;
}
