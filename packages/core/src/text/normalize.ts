/** 改行を \n に揃える。textarea もクリップボードも \r\n を投げてくる */
export function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
