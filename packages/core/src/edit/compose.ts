import * as composition from "../state/composition";
import { type EditState, type Limits, type Result, unchanged } from "../state/edit";
import * as history from "../state/history";
import { deleteSelection, replaceAt } from "./text";

/**
 * 変換 (IME) の操作。
 *
 * **変換中の字も本文に入れる。**預かって表示にだけ混ぜると、本文と表示で
 * 座標系が 2 つになる。履歴は 700ms のまとまりに乗るので、更新ごとに積んでも
 * 1 変換が 1 つの undo になる
 * → [decisions/0009](../../../../docs/decisions/0009-変換中の字も本文に入れる.md)
 */

/** 選択の上から始めたら、まず選択を消す。取り消されても消えたままなので知らせる */
export function beginComposition(state: EditState, limits: Limits): Result {
  if (!limits.editable) return unchanged(state);
  const cleared = deleteSelection(state, limits);
  return {
    state: {
      ...cleared.state,
      history: history.breakCoalescing(cleared.state.history),
      composition: composition.begin(cleared.state.head.offset),
    },
    changed: cleared.changed ?? "view",
    scrollIntoView: true,
  };
}

/** 変換中の字が変わった。いま入っている範囲を差し替える */
export function updateComposition(
  state: EditState,
  text: string,
  activeStart: number,
  activeEnd: number,
  limits: Limits,
): Result {
  const current = state.composition;
  if (!current) return unchanged(state);

  const result = replaceAt(state, current.start, current.end, text, limits);
  // maxLength で切られることがあるので、入った先は結果から読む
  const end = result.changed ? result.state.head.offset : current.start;
  const within = (at: number) => Math.min(Math.max(current.start + at, current.start), end);
  // キャレットは IME がいま対象にしている文節の末尾に乗る
  const head = within(activeEnd);

  return {
    state: {
      ...result.state,
      anchor: head,
      head: { offset: head, preferEnd: true },
      composition: { start: current.start, end, activeStart: within(activeStart), activeEnd: head },
    },
    changed: result.changed ?? "view",
    scrollIntoView: true,
  };
}

/**
 * 確定した。IME から渡される字は、いま本文に入っているものと違うことがある。
 * 空なら取り消しで、入っていた範囲が消える
 */
export function endComposition(state: EditState, text: string, limits: Limits): Result {
  const current = state.composition;
  if (!current) return unchanged(state);
  const result = replaceAt(state, current.start, current.end, text, limits);
  return {
    state: { ...result.state, composition: null },
    changed: result.changed ?? "view",
    scrollIntoView: true,
  };
}
