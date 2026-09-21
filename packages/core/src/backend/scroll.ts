/**
 * vertical-rl のスクロール位置。
 *
 * 送り方向に読み進んだ量は向きに依らず 0 以上で扱いたいが、
 * 素の scrollLeft は開始位置 (右端) を 0 として
 * Blink は負へ、WebKit は正へ動く。符号の規約が割れているので、
 * ここで距離に均す。
 */

/** 開始位置からの距離。0 以上 */
export function readScroll(el: HTMLElement, vertical: boolean): number {
  return vertical ? Math.abs(el.scrollLeft) : el.scrollTop;
}

export function writeScroll(el: HTMLElement, vertical: boolean, distance: number): void {
  if (!vertical) {
    el.scrollTop = distance;
    return;
  }
  // 範囲外は 0 に丸められる。負で動かなければ正の規約とみなす
  el.scrollLeft = -distance;
  if (Math.abs(el.scrollLeft) !== distance) el.scrollLeft = distance;
}
