import type { Caret, Goal } from "./model/movement";
import type { ResolvedOptions } from "./types";

/** container を基準にした、キャレットの居場所 */
export interface CaretRect {
  /** 行の中心 */
  x: number;
  /** 送り方向の位置 */
  y: number;
  /** キャレットの長さ (行を横切る向き) */
  size: number;
}

export interface CompositionRange {
  start: number;
  end: number;
  /** IME がいま対象にしている文節。無ければ start と同じ */
  activeStart: number;
  activeEnd: number;
}

/** バックエンドに渡す、いま表示すべきもの */
export interface ViewState {
  /** 変換中の文字を含めた表示用のテキスト */
  text: string;
  selection: { start: number; end: number };
  caret: Caret;
  caretVisible: boolean;
  focused: boolean;
  composition: CompositionRange | null;
  /** 本文が空のときだけ入る */
  placeholder: string | null;
}

/**
 * 縦組みの表示と、そこから引ける幾何だけを持つ。
 * テキストの中身・履歴・キー操作・IME は VertTextarea 側の仕事。
 */
export interface Backend {
  /** ポインタを拾う要素。container の中に置く */
  readonly surface: HTMLElement;

  setOptions(options: ResolvedOptions): void;
  /** 組み直す。幾何を引く前に呼ばれる */
  update(state: ViewState): void;

  /** 折り返しを含めた視覚行の数 */
  readonly lineCount: number;
  /** 行送り方向に何行ぶん見えているか */
  linesPerPage(): number;

  /** クライアント座標 → キャレット */
  hitTest(clientX: number, clientY: number): Caret;
  /** キャレット → container 基準の矩形 */
  caretRect(caret: Caret): CaretRect;

  /** 行を移る。縦書きでは direction 1 が左 (次の行) */
  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal };
  /** 行頭 / 行末へ */
  lineEdge(caret: Caret, edge: "start" | "end"): Caret;

  /** キャレットが見えるところまで送る */
  ensureVisible(caret: Caret): void;
  scrollOffset: number;

  destroy(): void;
}

export type BackendFactory = (container: HTMLElement, options: ResolvedOptions) => Backend;
