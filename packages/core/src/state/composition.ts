/**
 * 変換中の字が本文のどこに入っているか。作り直すだけで、書き換えない。
 *
 * **字そのものは本文 (`EditState.text`) に入っている。**ここが持つのは範囲だけ。
 * 預かって表示にだけ混ぜる作りにすると、本文と表示で座標系が 2 つになる
 * → [decisions/0009](../../../../docs/decisions/0009-変換中の字も本文に入れる.md)
 */
export interface CompositionState {
  /** 本文の上での、変換中の字の範囲 */
  readonly start: number;
  readonly end: number;
  /** IME がいま対象にしている文節。無ければ start と同じ */
  readonly activeStart: number;
  readonly activeEnd: number;
}

/** まだ 1 字も来ていない状態。差し込む位置だけ決まっている */
export function begin(at: number): CompositionState {
  return { start: at, end: at, activeStart: at, activeEnd: at };
}

/** 描く側へ渡す範囲。字が無ければ null */
export function rangeOf(composition: CompositionState | null): CompositionState | null {
  return composition && composition.end > composition.start ? composition : null;
}
