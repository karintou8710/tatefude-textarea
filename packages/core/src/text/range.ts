import { stepWord } from "../text/segment";

/**
 * 語と段落の範囲。本文だけを見て答えるので、レイアウトも DOM も要らない。
 * 折り返しで割れた行ではなく、`\n` で割れた段落を扱う。
 */

/** offset に乗っている語。境目に居るときは後ろの語を取る */
export function wordRangeAt(text: string, offset: number): [number, number] {
  const from = stepWord(text, Math.min(offset + 1, text.length), -1);
  return [from, stepWord(text, from, 1)];
}

export function paragraphRangeAt(text: string, offset: number): [number, number] {
  // offset が改行そのものを指していることがある (空行をクリックしたとき)。
  // 手前から探すと前の段落を拾って from > to になるので、改行の位置で切る
  const at = text[offset] === "\n" ? offset : Math.max(0, offset - 1);
  const from = text.lastIndexOf("\n", at) + 1;
  const found = text.indexOf("\n", from);
  return [from, found === -1 ? text.length : found];
}
