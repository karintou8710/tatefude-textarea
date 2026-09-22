/**
 * vertical-rl のスクロール位置。
 *
 * スクロール方向に読み進んだ量は向きに依らず 0 以上で扱いたいが、
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
  // **スクロールできる量はブラウザに聞く**。こちらの見積もりは端数を持つのに scrollWidth は
  // 整数なので、端までスクロールすると「頼んだ距離」と「着いた距離」が食い違う。
  // それを規約の違いと読むと、正の値を書いて先頭へ飛ぶ
  const max = Math.max(0, el.scrollWidth - el.clientWidth);
  const next = Math.min(Math.max(distance, 0), max);
  el.scrollLeft = -next;
  // 負でまったく動かなかったときだけ、正の規約とみなす
  if (next > 0 && el.scrollLeft === 0) el.scrollLeft = next;
}
