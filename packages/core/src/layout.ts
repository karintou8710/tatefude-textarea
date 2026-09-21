import type { Caret, Goal } from "./text/caret";

/**
 * レイアウトへの問い合わせ口。**組版そのものは backend が持つ。**
 *
 * 編集操作 (`edit/`) と受け口 (`input/`) は「行の切れ目がどこか」を知らないと
 * 決められないことがある。その問い合わせだけをここに置いて、
 * 描画の実装には依らせない。実装するのは backend の側。
 */

/**
 * container を基準にした、キャレットの居場所。
 * Range の潰れた矩形と同じで、厚みは持たない。
 * 縦書きなら width が em で height が 0、横書きなら逆になる。
 */
export interface CaretRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 選択の端につくつまみ。潰れているときは出さない */
export type Handle = "start" | "end";

/**
 * **役ごとに割る。**聞く側が要るものだけを宣言して、まとめた型は作らない。
 * 束ねるのは実装側の仕事 (`Backend extends Lines, Hits, Measures, …`)。
 *
 * 1 つの広い口にすると、②が `caretRect` を、①が `moveAcross` を
 * 触れてしまう。使っていないものが型から見えない状態を保つ。
 */

/**
 * ② 行を跨ぐ編集操作が聞くもの。**行の切れ目しか知らない。**
 *
 * 「↓ を押したら何文字目か」は本文だけでは決まらないので、ここだけは
 * ②がレイアウトに問い合わせる。矢印を持つ限り消せない依存
 * → [docs/decisions/0008](../../../docs/decisions/0008-最小実装は別パッケージで持たない.md)
 */
export interface Lines {
  /** 行送り方向に何行ぶん見えているか */
  linesPerPage(): number;
  /** 行を移る。縦書きでは direction 1 が左 (次の行) */
  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal };
  /** 行頭 / 行末へ */
  lineEdge(caret: Caret, edge: "start" | "end"): Caret;
}

/** ① 突いた場所を数える受け口が聞くもの */
export interface Hits {
  /** クライアント座標 → キャレット */
  hitTest(clientX: number, clientY: number): Caret;
  /** そこにつまみがあるか。描いた側が答える */
  hitHandle(clientX: number, clientY: number): Handle | null;
}

/**
 * レイアウトの結果を数で答えるもの。外へ出す矩形と、数えた寸法。
 * 繋ぐ側が公開 API に載せるのと、両バックエンドの突き合わせが使う
 */
export interface Measures {
  /** 折り返しを含めた視覚行の数 */
  readonly lineCount: number;
  /**
   * 全角 1 文字ぶんの送り量 (px)。
   * dom は CSS の計算値から、canvas は自分の指定から出す。
   * IME の候補ウィンドウを字に合わせるのに要る。
   */
  readonly fontSize: number;
  /** キャレット → container 基準の矩形 */
  caretRect(caret: Caret): CaretRect;
  /**
   * 選択の外接矩形 (container 基準)。選択が無ければ null。
   * 自前のメニューを選択の脇に出すのに要る
   */
  selectionRect(start: number, end: number): CaretRect | null;
}

/**
 * 送り方向の位置。慣性もラバーバンドもブラウザ側にあるので、
 * ここが持つのは「いくつ送られているか」と「どこまで戻すか」だけ。
 */
export interface Scroller {
  /** 行送り方向に読み進んだ量 (px)。向きに依らず 0 以上 */
  scrollOffset: number;
  /** 戻す約束を解く。触り直したら、前に突いた場所はもう用済み */
  forgetAnchor(): void;
}
