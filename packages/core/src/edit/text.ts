import { type EditState, type Limits, place, type Result, unchanged } from "../state/edit";
import type { EditKind, Snapshot } from "../state/history";
import * as history from "../state/history";
import { range, selectedText, selection, snapshot } from "../state/query";
import { normalize } from "../text/normalize";
import { stepGrapheme, stepWord, truncateGraphemes } from "../text/segment";
import type { Selection } from "../types";

/** 本文を動かす操作。どれも新しい state と、何が動いたかを返す */

/** 選択を置き換えて差し込む。キーの insert・貼り付け・公開 API が通る */
export function insert(state: EditState, raw: string, limits: Limits): Result {
  if (!limits.editable) return unchanged(state);
  const text = normalize(raw);
  if (!text) return unchanged(state);
  const [from, to] = range(state);
  return replace(state, from, to, text, "input", limits);
}

/**
 * 決まった範囲を差し替える。**変換の更新と確定だけが通る。**選択は見ない。
 * 入った先は返ってきた state の head から読む (maxLength で切られることがある)
 */
export function replaceAt(
  state: EditState,
  from: number,
  to: number,
  raw: string,
  limits: Limits,
): Result {
  if (!limits.editable) return unchanged(state);
  return replace(state, from, to, normalize(raw), "input", limits);
}

/** 選択を消す。切り取りと、変換を始めるときが通る */
export function deleteSelection(state: EditState, limits: Limits): Result {
  if (!limits.editable) return unchanged(state);
  const [from, to] = range(state);
  if (from === to) return unchanged(state);
  return replace(state, from, to, "", "delete", limits);
}

/** 選択があればそれを、無ければ 1 つぶん消す */
export function deleteBy(
  state: EditState,
  direction: 1 | -1,
  byWord: boolean,
  limits: Limits,
): Result {
  if (!limits.editable) return unchanged(state);
  const [from, to] = range(state);
  if (from !== to) return replace(state, from, to, "", "delete", limits);

  const at = state.head.offset;
  const other = byWord
    ? stepWord(state.text, at, direction)
    : stepGrapheme(state.text, at, direction);
  if (other === at) return unchanged(state);
  return replace(state, Math.min(at, other), Math.max(at, other), "", "delete", limits);
}

export interface CutResult extends Result {
  text: string;
}

/** 切り取る。消したあとでは返せないので、消す前に取っておく */
export function cut(state: EditState, limits: Limits): CutResult {
  return { text: selectedText(state), ...deleteSelection(state, limits) };
}

export function undo(state: EditState): Result {
  const back = history.undo(state.history, snapshot(state));
  if (!back) return unchanged(state);
  return {
    state: restore(state, back.snapshot, back.history),
    changed: "edit",
    scrollIntoView: false,
  };
}

export function redo(state: EditState): Result {
  const forward = history.redo(state.history, snapshot(state));
  if (!forward) return unchanged(state);
  return {
    state: restore(state, forward.snapshot, forward.history),
    changed: "edit",
    scrollIntoView: false,
  };
}

/** 中身を丸ごと入れ替える。履歴を残すかは呼び手が決める */
export function reset(
  state: EditState,
  raw: string,
  next?: Selection,
  keepHistory = false,
): Result {
  const text = normalize(raw);
  if (text === state.text && !next) return unchanged(state);
  return {
    state: {
      text,
      ...place(text, next ?? selection(state)),
      history: keepHistory ? state.history : history.emptyHistory,
      // 変換中だったなら、その範囲はもう無い
      composition: null,
    },
    changed: "edit",
    scrollIntoView: false,
  };
}

/**
 * 範囲を差し替える。maxLength に収まるぶんだけ入れる。
 * 何も入らず何も消えないなら、元の state をそのまま返す
 */
function replace(
  state: EditState,
  from: number,
  to: number,
  insert: string,
  kind: EditKind,
  limits: Limits,
): Result {
  const room = limits.maxLength - (state.text.length - (to - from));
  const text = room >= insert.length ? insert : truncateGraphemes(insert, room);
  if (from === to && text.length === 0) return unchanged(state);

  const at = from + text.length;
  return {
    state: {
      ...state,
      text: state.text.slice(0, from) + text + state.text.slice(to),
      anchor: at,
      head: { offset: at, preferEnd: false },
      goal: null,
      history: history.push(state.history, snapshot(state), kind),
    },
    changed: "edit",
    scrollIntoView: true,
  };
}

function restore(state: EditState, back: Snapshot, next: history.HistoryState): EditState {
  return {
    ...state,
    text: back.text,
    ...place(back.text, back.selection),
    history: next,
    composition: null,
  };
}
