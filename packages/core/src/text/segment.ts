export interface Grapheme {
  text: string;
  /** 元テキスト中の UTF-16 オフセット */
  start: number;
  end: number;
}

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("ja", { granularity: "grapheme" })
    : null;

const wordSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("ja", { granularity: "word" })
    : null;

/**
 * 書記素クラスタに割る。異体字セレクタや結合絵文字を 1 文字として扱いたいので、
 * コードポイント単位では割らない。
 */
export function segmentGraphemes(text: string, base = 0): Grapheme[] {
  const result: Grapheme[] = [];
  if (graphemeSegmenter) {
    for (const segment of graphemeSegmenter.segment(text)) {
      result.push({
        text: segment.segment,
        start: base + segment.index,
        end: base + segment.index + segment.segment.length,
      });
    }
    return result;
  }

  // Intl.Segmenter が無い環境向け。サロゲートペアだけは守る
  for (const ch of text) {
    const start = result.length === 0 ? base : result[result.length - 1].end;
    result.push({ text: ch, start, end: start + ch.length });
  }
  return result;
}

/** offset から前後 1 書記素ぶん動いた位置。端では offset のまま返す */
export function stepGrapheme(text: string, offset: number, direction: 1 | -1): number {
  if (direction === 1 && offset >= text.length) return offset;
  if (direction === -1 && offset <= 0) return offset;

  // 走査範囲を絞る。結合列は長くても数十コードユニット
  const windowStart = Math.max(0, offset - 32);
  const windowEnd = Math.min(text.length, offset + 32);
  const graphemes = segmentGraphemes(text.slice(windowStart, windowEnd), windowStart);

  if (direction === 1) {
    for (const g of graphemes) {
      if (g.start <= offset && g.end > offset) return g.end;
    }
    return Math.min(text.length, offset + 1);
  }
  for (let i = graphemes.length - 1; i >= 0; i--) {
    const g = graphemes[i];
    if (g.end >= offset && g.start < offset) return g.start;
  }
  return Math.max(0, offset - 1);
}

/** offset から前後 1 単語ぶん動いた位置 */
export function stepWord(text: string, offset: number, direction: 1 | -1): number {
  if (!wordSegmenter) return stepGrapheme(text, offset, direction);
  if (direction === 1 && offset >= text.length) return offset;
  if (direction === -1 && offset <= 0) return offset;

  const boundaries: number[] = [0];
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.index > 0) boundaries.push(segment.index);
  }
  boundaries.push(text.length);

  if (direction === 1) {
    for (const b of boundaries) if (b > offset) return b;
    return text.length;
  }
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (boundaries[i] < offset) return boundaries[i];
  }
  return 0;
}

/**
 * max コード単位に収まるところまで切る。**書記素は割らない。**
 * 割ると片割れのサロゲートや裸の結合文字が本文に入ってしまう。
 */
export function truncateGraphemes(text: string, max: number): string {
  if (max >= text.length) return text;
  if (max <= 0) return "";
  let end = 0;
  for (const g of segmentGraphemes(text)) {
    if (g.end > max) break;
    end = g.end;
  }
  return text.slice(0, end);
}
