import type { Caret, Goal } from "../../model/movement";
import { lineIndexOfOffset, offsetAtLineDistance, offsetInLine } from "./geometry";
import type { Layout } from "./layout";

/**
 * 組んだ結果 (Layout) を引いて動く。dom バックエンドは同じことを
 * Range API で引くので、こちらは canvas だけが使う。
 */

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
