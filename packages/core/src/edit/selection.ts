import type { Handle } from "../layout";
import { type EditState, place, type Result } from "../state/edit";
import * as history from "../state/history";
import { range } from "../state/query";
import type { Caret, Goal } from "../text/caret";
import { paragraphRangeAt, wordRangeAt } from "../text/range";

/** 選ぶ・動かす操作。本文は触らない */

export function setSelection(state: EditState, anchor: number, head = anchor): Result {
  return {
    state: {
      ...state,
      ...place(state.text, { anchor, head }),
      history: history.breakCoalescing(state.history),
    },
    changed: "selection",
  };
}

export function selectAll(state: EditState): Result {
  return setSelection(state, 0, state.text.length);
}

/** キャレットを動かす。extend なら掴んだ側を置いたまま伸ばす */
export function moveCaret(
  state: EditState,
  head: Caret,
  extend: boolean,
  goal: Goal = null,
): Result {
  return {
    state: {
      ...state,
      head,
      goal,
      anchor: extend ? state.anchor : head.offset,
      history: history.breakCoalescing(state.history),
    },
    changed: "selection",
  };
}

export function selectWord(state: EditState, offset: number): Result {
  const [from, to] = wordRangeAt(state.text, offset);
  return setSelection(state, from, to);
}

export function selectParagraph(state: EditState, offset: number): Result {
  const [from, to] = paragraphRangeAt(state.text, offset);
  return setSelection(state, from, to);
}

/**
 * つまみを掴んだ。動かす側を head に、反対の端を anchor に置き直す。
 * あとは伸ばすだけになるので、掴んだあとの扱いはドラッグと同じ
 */
export function grabHandle(state: EditState, handle: Handle): Result {
  const [from, to] = range(state);
  return handle === "start" ? setSelection(state, to, from) : setSelection(state, from, to);
}

/** 打つ前に、まとまりの窓を閉じる。focus を失ったときにも呼ぶ */
export function breakCoalescing(state: EditState): EditState {
  return { ...state, history: history.breakCoalescing(state.history) };
}
