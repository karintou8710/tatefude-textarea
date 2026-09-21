import type { Caret } from "../text/caret";

/**
 * 預かっている変換中の字。作り直すだけで、書き換えない。
 * 確定するまで本文には入れず、表示にだけ混ぜる。
 */
export interface CompositionState {
  /** 変換中の字が入る、確定済みテキスト上の位置 */
  readonly start: number;
  readonly text: string;
  readonly activeStart: number;
  readonly activeEnd: number;
}

/** 表示用テキストの上での、変換中の字の範囲 */
export interface CompositionRange {
  start: number;
  end: number;
  /** IME がいま対象にしている文節。無ければ start と同じ */
  activeStart: number;
  activeEnd: number;
}

export function begin(at: number): CompositionState {
  return { start: at, text: "", activeStart: 0, activeEnd: 0 };
}

export function update(
  composition: CompositionState,
  text: string,
  activeStart: number,
  activeEnd: number,
): CompositionState {
  return { ...composition, text, activeStart, activeEnd };
}

/** 変換中の字を差し込んだ、画面に出すテキスト */
export function textOver(composition: CompositionState | null, text: string): string {
  if (!composition) return text;
  return text.slice(0, composition.start) + composition.text + text.slice(composition.start);
}

/** 描画・当たり判定で使う、変換中の字を含めたキャレット */
export function caretOver(composition: CompositionState | null, caret: Caret): Caret {
  if (!composition) return caret;
  return { offset: composition.start + composition.activeEnd, preferEnd: true };
}

/** 表示用テキストの上での範囲。変換中の字が無ければ null */
export function rangeOf(composition: CompositionState | null): CompositionRange | null {
  if (!composition || composition.text.length === 0) return null;
  return {
    start: composition.start,
    end: composition.start + composition.text.length,
    activeStart: composition.start + composition.activeStart,
    activeEnd: composition.start + composition.activeEnd,
  };
}
