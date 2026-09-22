import type { Caret } from "../text/caret";
import type { Selection } from "../types";
import type { CompositionState } from "./composition";
import * as composition from "./composition";
import type { EditState } from "./edit";
import type { Snapshot } from "./history";

/**
 * 画面に出すべき中身。状態から引けるものだけで、
 * レイアウトも色も点滅も知らない。描き方は backend の仕事
 */
export interface ViewContent {
  /** 本文。変換中の字も入っている */
  readonly text: string;
  /** 確定済みテキストの上での選択範囲 */
  readonly selection: { readonly start: number; readonly end: number };
  /** キャレット */
  readonly caret: Caret;
  /** 選択が潰れているか */
  readonly collapsed: boolean;
  readonly composing: boolean;
  readonly composition: CompositionState | null;
  readonly empty: boolean;
}

/** state から引き出すもの。どれも state を触らない */

/** 選択範囲を前後の順に揃えて返す */
export function range(state: EditState): [number, number] {
  const a = state.anchor;
  const b = state.head.offset;
  return a <= b ? [a, b] : [b, a];
}

export function selection(state: EditState): Selection {
  return { anchor: state.anchor, head: state.head.offset };
}

export function selectedText(state: EditState): string {
  const [from, to] = range(state);
  return state.text.slice(from, to);
}

export function composing(state: EditState): boolean {
  return state.composition !== null;
}

/** 画面に出すべき中身。レイアウトも色も点滅も知らない */
export function viewContent(state: EditState): ViewContent {
  const [start, end] = range(state);
  return {
    text: state.text,
    selection: { start, end },
    caret: state.head,
    collapsed: state.anchor === state.head.offset,
    composing: composing(state),
    composition: composition.rangeOf(state.composition),
    empty: state.text.length === 0,
  };
}

/** 履歴に積む形 */
export function snapshot(state: EditState): Snapshot {
  return { text: state.text, selection: selection(state) };
}
