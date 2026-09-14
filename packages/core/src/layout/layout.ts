import {
  isLatinWordChar,
  isLineEndForbidden,
  isLineStartForbidden,
  type Orientation,
  orientationOf,
} from "../text/char-class";
import { type Grapheme, segmentGraphemes } from "../text/segment";
import type { WritingMode } from "../types";
import type { Measurer } from "./measure";

export interface PlacedChar {
  text: string;
  /** 元テキスト中の UTF-16 オフセット */
  start: number;
  end: number;
  orientation: Orientation;
  /** 行の中での、送り方向 (下向き) の開始位置 */
  offset: number;
  advance: number;
}

export interface LayoutLine {
  /** 視覚行の番号。0 が一番右の行 */
  index: number;
  /** 何番目の論理行 (改行で区切った段落) に属するか */
  paragraph: number;
  /** 改行文字は含まない */
  start: number;
  end: number;
  chars: PlacedChar[];
  /** 送り方向に使っている長さ */
  length: number;
  /** この行が改行文字で終わるか。折り返しなら false */
  hardBreak: boolean;
}

export interface Layout {
  lines: LayoutLine[];
  /** 送り方向に使える長さ */
  maxLineLength: number;
}

export interface LayoutParams {
  text: string;
  maxLineLength: number;
  measurer: Measurer;
  kinsoku: boolean;
  /** 既定は縦書き */
  writingMode?: WritingMode;
}

function isHangingSpace(text: string): boolean {
  return text === " " || text === "\t";
}

/** 禁則で行を戻す上限。これを超えると諦めてそのまま切る */
const KINSOKU_BACKTRACK_LIMIT = 6;

export function layoutText({
  text,
  maxLineLength,
  measurer,
  kinsoku,
  writingMode = "vertical-rl",
}: LayoutParams): Layout {
  // 横書きでは字を倒す必要が無く、送りは横書きの字幅そのもの
  const vertical = writingMode === "vertical-rl";
  const orientationOfChar = (ch: string): Orientation => (vertical ? orientationOf(ch) : "upright");
  const advanceOf = (ch: string, orientation: Orientation) =>
    vertical ? measurer.advance(ch, orientation) : measurer.width(ch);

  const lines: LayoutLine[] = [];
  const paragraphs = text.split("\n");
  let base = 0;

  for (let p = 0; p < paragraphs.length; p++) {
    const paragraph = paragraphs[p];
    const hardBreak = p < paragraphs.length - 1;
    const graphemes = segmentGraphemes(paragraph, base);
    const advances = graphemes.map((g) => advanceOf(g.text, orientationOfChar(g.text)));

    let cursor = 0;
    if (graphemes.length === 0) {
      lines.push(emptyLine(lines.length, p, base, hardBreak));
    }

    while (cursor < graphemes.length) {
      let used = 0;
      let end = cursor;
      while (end < graphemes.length) {
        const next = used + advances[end];
        // 1 文字だけは行長を超えても置く。置かないと進まない
        if (next > maxLineLength && end > cursor) break;
        used = next;
        end++;
      }

      if (end < graphemes.length && kinsoku) {
        end = adjustBreak(graphemes, cursor, end);
      }
      // pre-wrap では、折り返しを起こした空白は行末にぶら下がって行長に効かない。
      // ネイティブの textarea と同じ位置で折るために、この 1 つは行に残す
      if (end < graphemes.length && isHangingSpace(graphemes[end].text)) {
        end += 1;
      }

      lines.push(
        buildLine(
          lines.length,
          p,
          graphemes,
          advances,
          cursor,
          end,
          hardBreak && end === graphemes.length,
          orientationOfChar,
        ),
      );
      cursor = end;
    }

    base += paragraph.length + 1;
  }

  return { lines, maxLineLength };
}

function emptyLine(index: number, paragraph: number, at: number, hardBreak: boolean): LayoutLine {
  return { index, paragraph, start: at, end: at, chars: [], length: 0, hardBreak };
}

function buildLine(
  index: number,
  paragraph: number,
  graphemes: Grapheme[],
  advances: number[],
  from: number,
  to: number,
  hardBreak: boolean,
  orientationOfChar: (ch: string) => Orientation,
): LayoutLine {
  const chars: PlacedChar[] = [];
  let offset = 0;
  for (let i = from; i < to; i++) {
    const g = graphemes[i];
    chars.push({
      text: g.text,
      start: g.start,
      end: g.end,
      orientation: orientationOfChar(g.text),
      offset,
      advance: advances[i],
    });
    offset += advances[i];
  }
  return {
    index,
    paragraph,
    start: graphemes[from].start,
    end: graphemes[to - 1].end,
    chars,
    length: offset,
    hardBreak,
  };
}

/**
 * 折り返し位置 `to` (次の行の先頭になる書記素の index) を禁則で手前にずらす。
 * 追い込み (行に詰める) はせず、追い出し (次の行へ送る) だけで直す。
 */
function adjustBreak(graphemes: Grapheme[], from: number, to: number): number {
  // 行が空になるところまでは戻さない
  const min = from + 1;
  let at = to;

  for (let n = 0; n < KINSOKU_BACKTRACK_LIMIT && at > min; n++) {
    if (isLineStartForbidden(graphemes[at].text)) {
      at--;
      continue;
    }
    if (isLineEndForbidden(graphemes[at - 1].text)) {
      at--;
      continue;
    }
    break;
  }

  return avoidSplittingLatinWord(graphemes, from, at);
}

function avoidSplittingLatinWord(graphemes: Grapheme[], from: number, to: number): number {
  if (to <= from + 1) return to;
  if (!isLatinWordChar(graphemes[to].text) || !isLatinWordChar(graphemes[to - 1].text)) return to;

  let at = to;
  while (at > from && isLatinWordChar(graphemes[at - 1].text)) at--;
  // 綴りが行に収まらないなら、途中で切るしかない
  return at > from ? at : to;
}
