/**
 * キャレットの位置と、折り返しの境目でどちら側の行に着けるか。
 * 前の行の末尾と次の行の先頭は同じ offset になるので preferEnd で区別する。
 */
export interface Caret {
  readonly offset: number;
  readonly preferEnd: boolean;
}

/** 行を跨いで動くときに保つ「元いたスクロール位置」 */
export type Goal = number | null;
