import type { Caret } from "../text/caret";
import type { Selection } from "../types";
import type { CompositionRange } from "./composition";
import * as composition from "./composition";
import type { EditState } from "./edit";
import type { Snapshot } from "./history";

/**
 * 画面に出すべき中身。状態から引けるものだけで、
 * レイアウトも色も点滅も知らない。描き方は backend の仕事
 */
export interface ViewContent {
  /** 変換中の字を差し込んだ表示用テキスト */
  readonly text: string;
  /** 確定済みテキストの上での選択範囲 */
  readonly selection: { readonly start: number; readonly end: number };
  /** 変換中の字を含めたキャレット */
  readonly caret: Caret;
  /** 選択が潰れているか */
  readonly collapsed: boolean;
  readonly composing: boolean;
  readonly composition: CompositionRange | null;
  readonly empty: boolean;
}

/** state から引き出すもの。どれも state を触らない */

/** 選択範囲を前後の順に揃えて返す */
export function range(state: EditState): [number, number] {
  const a = state.anchor;
  const b = state.caret.offset;
  return a <= b ? [a, b] : [b, a];
}

export function selection(state: EditState): Selection {
  return { anchor: state.anchor, focus: state.caret.offset };
}

export function selectedText(state: EditState): string {
  const [from, to] = range(state);
  return state.text.slice(from, to);
}

export function composing(state: EditState): boolean {
  return state.composition !== null;
}

/** 描画・当たり判定で使う、変換中の字を含めたキャレット */
export function displayCaret(state: EditState): Caret {
  return composition.caretOver(state.composition, state.caret);
}

/** 画面に出すべき中身。レイアウトも色も点滅も知らない */
export function viewContent(state: EditState): ViewContent {
  const [start, end] = range(state);
  return {
    text: composition.textOver(state.composition, state.text),
    selection: { start, end },
    caret: displayCaret(state),
    collapsed: state.anchor === state.caret.offset,
    composing: composing(state),
    composition: composition.rangeOf(state.composition),
    empty: state.text.length === 0,
  };
}

/** 履歴に積む形 */
export function snapshot(state: EditState): Snapshot {
  return { text: state.text, selection: selection(state) };
}
