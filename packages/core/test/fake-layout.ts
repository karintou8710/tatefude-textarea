import type { Lines } from "../src/backend/backend";
import type { Caret, Goal } from "../src/text/caret";

interface Line {
  start: number;
  end: number;
  /** 行末が改行か。折り返しで割れた行は false */
  hardBreak: boolean;
}

/**
 * 決まった字数で折り返すだけのレイアウト。
 * 組版そのものは test/unit/layout.test.ts が本物で見ているので、
 * commands のテストでは行の切れ目だけ再現できればいい。
 *
 * 答えるのは `Lines` の 3 つだけ。**幾何は型に無いので、塞ぐ必要もない。**
 */
export function fakeLayout(text: string, perLine: number, linesPerPage = 2): Lines {
  const lines = splitLines(text, perLine);

  const indexOf = (caret: Caret): number => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (caret.offset < line.start) continue;
      if (caret.offset > line.end) continue;
      // 折り返しの境目は前後 2 行に乗る。preferEnd が前の行を指す
      if (caret.offset === line.end && !caret.preferEnd && i + 1 < lines.length) continue;
      return i;
    }
    return lines.length - 1;
  };

  return {
    linesPerPage: () => linesPerPage,

    lineEdge(caret: Caret, edge: "start" | "end"): Caret {
      const line = lines[indexOf(caret)];
      if (edge === "start") return { offset: line.start, preferEnd: false };
      return { offset: line.end, preferEnd: true };
    },

    moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal } {
      const from = indexOf(caret);
      const distance = goal ?? caret.offset - lines[from].start;
      const to = from + direction;

      if (to < 0) return { caret: { offset: lines[0].start, preferEnd: false }, goal: distance };
      if (to >= lines.length) {
        const last = lines[lines.length - 1];
        return { caret: { offset: last.end, preferEnd: true }, goal: distance };
      }

      const line = lines[to];
      const offset = Math.min(line.start + distance, line.end);
      return {
        caret: { offset, preferEnd: offset === line.end && !line.hardBreak },
        goal: distance,
      };
    },
  };
}

function splitLines(text: string, perLine: number): Line[] {
  const lines: Line[] = [];
  const paragraphs = text.split("\n");
  let at = 0;
  for (let p = 0; p < paragraphs.length; p++) {
    const paragraph = paragraphs[p];
    // 末尾に改行が続くか。本文の最後の行だけは続かない
    const hardBreak = p < paragraphs.length - 1;
    if (paragraph.length === 0) {
      lines.push({ start: at, end: at, hardBreak });
    } else {
      for (let i = 0; i < paragraph.length; i += perLine) {
        const length = Math.min(perLine, paragraph.length - i);
        lines.push({
          start: at + i,
          end: at + i + length,
          hardBreak: hardBreak && i + length >= paragraph.length,
        });
      }
    }
    at += paragraph.length + 1;
  }
  return lines;
}
