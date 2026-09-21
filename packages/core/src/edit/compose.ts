import * as composition from "../state/composition";
import { type EditState, type Limits, type Result, unchanged } from "../state/edit";
import * as history from "../state/history";
import { deleteSelection, insertAt } from "./text";

/** 変換 (IME) の操作。確定するまで本文には入れず、state に預ける */

/** 選択の上から始めたら、まず選択を消す。取り消されても消えたままなので知らせる */
export function beginComposition(state: EditState, limits: Limits): Result {
  if (!limits.editable) return unchanged(state);
  const cleared = deleteSelection(state, limits);
  return {
    state: {
      ...cleared.state,
      history: history.breakCoalescing(cleared.state.history),
      composition: composition.begin(cleared.state.caret.offset),
    },
    changed: cleared.changed ?? "view",
  };
}

export function updateComposition(
  state: EditState,
  text: string,
  activeStart: number,
  activeEnd: number,
): Result {
  if (!state.composition) return unchanged(state);
  return {
    state: {
      ...state,
      composition: composition.update(state.composition, text, activeStart, activeEnd),
    },
    changed: "view",
  };
}

/** 確定した文字列は IME から渡される。預かっていた位置へ入れる */
export function endComposition(state: EditState, text: string, limits: Limits): Result {
  if (!state.composition) return unchanged(state);
  // 確定した文字列が空でも、預かっていた字と下線を消すために描き直す
  const cleared: EditState = { ...state, composition: null };
  if (!text) return { state: cleared, changed: "view" };
  const result = insertAt(cleared, state.composition.start, text, limits);
  return result.changed ? result : { state: cleared, changed: "view" };
}
