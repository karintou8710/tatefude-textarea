import type { Caret, Goal } from "../text/caret";
import { normalize } from "../text/normalize";
import type { Selection } from "../types";
import type { CompositionState } from "./composition";
import { emptyHistory, type HistoryState } from "./history";

/**
 * 編集の状態。**作り直すだけで、書き換えない。**
 *
 * `edit/` の操作はこれを受け取って新しいものを返す。
 * 差し替えるのは `textarea.ts` の `apply` 1 箇所だけなので、
 * 「いつ変わったか」と「描き直したか」がずれない。
 */
export interface EditState {
  readonly text: string;
  /** 選択の掴んだ側 */
  readonly anchor: number;
  /** 選択の動く側 */
  readonly head: Caret;
  /** 行を跨ぐときに保つ、元いた字送り方向の位置 */
  readonly goal: Goal;
  readonly history: HistoryState;
  /** 預かっている変換中の字。変換していなければ null */
  readonly composition: CompositionState | null;
}

/** textarea と同じで、初期のキャレットは文頭に置く */
export function newEditState(text = ""): EditState {
  return {
    text: normalize(text),
    anchor: 0,
    head: { offset: 0, preferEnd: false },
    goal: null,
    history: emptyHistory,
    composition: null,
  };
}

/**
 * 何が動いたか。呼び手はこれを見て、描き直すか・外へ知らせるかを決める。
 * `view` は画面だけ (変換中の字が伸び縮みしたときなど)。
 */
export type Changed = "edit" | "selection" | "view" | null;

/** 動いたあとの状態と、何が動いたか。`changed` が null なら state は元のまま */
export interface Result {
  readonly state: EditState;
  readonly changed: Changed;
}

export function unchanged(state: EditState): Result {
  return { state, changed: null };
}

/** options から来る、編集にかかる制限 */
export interface Limits {
  /** 打ち込めるか。readOnly でも disabled でもない */
  editable: boolean;
  maxLength: number;
}

/** 本文の長さに収めて選択を置く。移動の狙いは、置き直したら用済み */
export function place(
  text: string,
  selection: Selection,
): Pick<EditState, "anchor" | "head" | "goal"> {
  return {
    anchor: clamp(selection.anchor, 0, text.length),
    head: { offset: clamp(selection.head, 0, text.length), preferEnd: false },
    goal: null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
