import type { Hits, Lines, Measures, Scroller } from "../layout";
import type { CompositionState } from "../state/composition";
import type { Caret } from "../text/caret";
import type { ResolvedOptions } from "../types";

/** バックエンドに渡す、いま表示すべきもの */
export interface ViewState {
  /** 変換中の文字を含めた表示用のテキスト */
  text: string;
  selection: { start: number; end: number };
  caret: Caret;
  caretVisible: boolean;
  focused: boolean;
  /** 選択の両端にハンドルを出すか。指で触ったときだけ出す */
  handles: boolean;
  composition: CompositionState | null;
  /** 本文が空のときだけ入る */
  placeholder: string | null;
}

/** レイアウトと描き直し。状態を受け取って画面に出す側 */
export interface Painter {
  setOptions(options: ResolvedOptions): void;
  /**
   * CSS を読み直してレイアウトし直す。
   * 見た目は CSS に置いたが、CSS には「変わった」を知らせる口が無い。
   * コンテナの寸法なら ResizeObserver で足りるものの、字の大きさや余白を
   * 変えてもコンテナは動かないので、変えた側から呼んでもらう。
   */
  refresh(): void;
  /** 描き直すだけ。スクロールは動かさない (点滅など) */
  update(state: ViewState): void;
  /**
   * 描き直して、キャレットを見える位置に置き、そこを控える。
   * 本文や選択が動いたときはこちら。スクロールをどう動かすかは中の事情なので外へ出さない
   */
  /**
   * 本文や選択が動いたときはこちら。スクロールをどう動かすかは中の事情なので外へ出さない。
   * `scrollIntoView` が true なら、キャレットを画面に入れてから描く
   */
  show(state: ViewState, scrollIntoView: boolean): void;
}

/**
 * 縦組みの表示と、そこから引ける幾何だけを持つ。
 * テキストの中身・履歴・キー操作・IME は Textarea 側の仕事。
 *
 * **束ねるのは実装側だけ。**部品に配るときは役ごとの口 (`Lines` / `Hits` /
 * `Measures` / `Scroller` / `Painter`) で渡して、何に依っているかを見せる。
 */
export interface Backend extends Lines, Hits, Measures, Scroller, Painter {
  /** ポインタを拾う要素。container の中に置く */
  readonly surface: HTMLElement;
  destroy(): void;
}

export type { CaretRect, Handle, Hits, Lines, Measures, Scroller } from "../layout";
export type { CompositionState } from "../state/composition";
