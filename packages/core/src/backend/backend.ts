import type { Caret, Goal } from "../model/movement";
import type { ResolvedOptions } from "../types";

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
  /** 選択の両端につまみを出すか。指で触ったときだけ出す */
  handles: boolean;
  composition: CompositionRange | null;
  /** 本文が空のときだけ入る */
  placeholder: string | null;
}

/**
 * 組み上がりから幾何を引く。どこに何が落ちたかを答えるだけで、書き換えはしない。
 */
export interface Layout {
  /** 折り返しを含めた視覚行の数 */
  readonly lineCount: number;
  /**
   * 全角 1 文字ぶんの送り量 (px)。
   * dom は CSS の計算値から、canvas は自分の指定から出す。
   * IME の候補ウィンドウを字に合わせるのに要る。
   */
  readonly fontSize: number;
  /** 行送り方向に何行ぶん見えているか */
  linesPerPage(): number;

  /** クライアント座標 → キャレット */
  hitTest(clientX: number, clientY: number): Caret;
  /** そこにつまみがあるか。描いた側が答える */
  hitHandle(clientX: number, clientY: number): Handle | null;
  /** キャレット → container 基準の矩形 */
  caretRect(caret: Caret): CaretRect;
  /**
   * 選択の外接矩形 (container 基準)。選択が無ければ null。
   * 自前のメニューを選択の脇に出すのに要る
   */
  selectionRect(start: number, end: number): CaretRect | null;

  /** 行を移る。縦書きでは direction 1 が左 (次の行) */
  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal };
  /** 行頭 / 行末へ */
  lineEdge(caret: Caret, edge: "start" | "end"): Caret;
}

/**
 * 送り方向の位置。慣性もラバーバンドもブラウザ側にあるので、
 * ここが持つのは「いくつ送られているか」と「どこまで戻すか」だけ。
 */
export interface Scroller {
  /** 行送り方向に読み進んだ量 (px)。向きに依らず 0 以上 */
  scrollOffset: number;
  /** キャレットが見えるところまで送る */
  ensureVisible(caret: Caret): void;
  /**
   * いまのキャレットの位置を覚える。組み直しのたびに、行送り方向の座標をそこへ戻す。
   * 器が縮んで組み直っても、突いた列が横に動かないようにするため。
   * キーボードは何段階かに分けて器を縮めてくるので、1 回使っただけでは捨てない。
   * キャレットが動くか、自分で送ったら忘れる
   */
  anchorCaret(): void;
  /** 戻す約束を解く。触り直したら、前に突いた場所はもう用済み */
  forgetAnchor(): void;
}

/** 組み直しと描き直し。状態を受け取って画面に出す側 */
export interface Painter {
  setOptions(options: ResolvedOptions): void;
  /**
   * CSS を読み直して組み直す。
   * 見た目は CSS に置いたが、CSS には「変わった」を知らせる口が無い。
   * 器の寸法なら ResizeObserver で足りるものの、字の大きさや余白を
   * 変えても器は動かないので、変えた側から叩いてもらう。
   */
  refresh(): void;
  /** 組み直す。幾何を引く前に呼ばれる */
  update(state: ViewState): void;
}

/**
 * 縦組みの表示と、そこから引ける幾何だけを持つ。
 * テキストの中身・履歴・キー操作・IME は Textarea 側の仕事。
 *
 * 3 つの役の合併。Textarea の中では、要るところだけ Layout / Scroller /
 * Painter で受けて、何に依っているかを見えるようにする。
 */
export interface Backend extends Layout, Scroller, Painter {
  /** ポインタを拾う要素。container の中に置く */
  readonly surface: HTMLElement;
  destroy(): void;
}

export type BackendFactory = (container: HTMLElement, options: ResolvedOptions) => Backend;
