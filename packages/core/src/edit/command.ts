import type { Lines } from "../layout";
import { type EditState, type Limits, type Result, unchanged } from "../state/edit";
import { range } from "../state/query";
import type { Caret, Goal } from "../text/caret";
import { moveInline, paragraphEdge } from "../text/move";
import { moveCaret, selectAll } from "./selection";
import { deleteBy, insert, redo, undo } from "./text";

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

/**
 * 指示を操作へ振り分ける。
 *
 * 行を跨ぐものだけ `Lines` に聞く。ほかは本文だけで決まる。
 */
export function runCommand(
  state: EditState,
  command: Command,
  lines: Lines,
  limits: Limits,
): Result {
  switch (command.type) {
    case "stepInline":
      return stepInline(state, command.direction, command.word, command.extend);

    case "lineEdge":
      return moveCaret(state, lines.lineEdge(state.head, command.edge), command.extend);

    case "docEdge":
      return moveCaret(
        state,
        command.edge === "end"
          ? { offset: state.text.length, preferEnd: true }
          : { offset: 0, preferEnd: false },
        command.extend,
      );

    case "paragraphEdge":
      return moveCaret(
        state,
        paragraphEdge(state.text, state.head.offset, command.direction),
        command.extend,
      );

    case "moveAcross": {
      const moved = lines.moveAcross(state.head, command.direction, state.goal);
      return moveCaret(state, moved.caret, command.extend, moved.goal);
    }

    case "page": {
      const moved = movePage(state, lines, command.direction);
      return moveCaret(state, moved.caret, command.extend, moved.goal);
    }

    case "delete":
      return deleteBy(state, command.direction, command.word, limits);

    case "insert":
      return insert(state, command.text, limits);

    case "selectAll":
      return selectAll(state);

    case "undo":
      return undo(state);

    case "redo":
      return redo(state);
  }
}

/**
 * 行の中を 1 つ動く。縦書きでは下 / 上。
 * 選んでいるときの 1 文字ぶんは、選んだ端に畳むだけで進まない (Blink も同じ)。
 */
function stepInline(state: EditState, direction: 1 | -1, byWord: boolean, extend: boolean): Result {
  const [from, to] = range(state);
  if (!extend && !byWord && from !== to) {
    return moveCaret(
      state,
      { offset: direction === 1 ? to : from, preferEnd: state.head.preferEnd },
      false,
    );
  }

  const next = moveInline(state.text, state.head, direction, byWord);
  // 端に着いていて動けないなら何もしない。行を移るときの狙いも消さずに残す
  const anchor = extend ? state.anchor : next.offset;
  if (next.offset === state.head.offset && anchor === state.anchor) return unchanged(state);
  return moveCaret(state, next, extend);
}

function movePage(state: EditState, lines: Lines, direction: 1 | -1): { caret: Caret; goal: Goal } {
  let moved = { caret: state.head, goal: state.goal };
  for (let i = 0; i < lines.linesPerPage(); i++) {
    moved = lines.moveAcross(moved.caret, direction, moved.goal);
  }
  return moved;
}
