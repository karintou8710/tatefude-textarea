/**
 * 字が入っている箱の長さ (ascent + descent)。行送りは含まない。
 *
 * キャレットの長さはこれ。Blink も同じで、caret_rect.cc は字の入っている箱の
 * 大きさを使い、行ボックスは位置を収めるためだけに見ている。
 *
 * DOM でレイアウトさせて測ると行送りに引きずられるので、フォントそのものの寸法を
 * canvas の measureText から引く。レイアウトに依らない値なので両バックエンドで使える。
 */
const cache = new Map<string, number>();

/** 代表の 1 字。字ごとに落ちるフォントは変わるが、キャレットは行に 1 本しかない */
const SAMPLE = "あ";

/**
 * @param css `font` の短縮形。dom は計算値から、canvas は自分の指定から組み立てる
 * @param fallback 測れなかったときに使う長さ。字の大きさを渡す
 */
export function fontBoxSize(doc: Document, css: string, fallback: number): number {
  const hit = cache.get(css);
  if (hit !== undefined) return hit;

  const ctx = doc.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;

  ctx.font = css;
  const metrics = ctx.measureText(SAMPLE);
  const size = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent || fallback;

  cache.set(css, size);
  return size;
}
