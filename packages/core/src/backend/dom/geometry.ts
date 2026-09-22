import type { Caret, Goal } from "../../text/caret";
import type { CaretRect, Handle, ViewState } from "../backend";
import { type HandlePoint, handleCenter } from "../handle";
import type { Axis, Rect } from "./axis";
import {
  blockOfCaret,
  blockOfCaretInLayer,
  blockOfPoint,
  inlineEndOf,
  inlineInLayer,
  inlineOfCaret,
  inlineSizeOf,
  inlineStartOf,
  layerLength,
  lineAt,
  lineOfRect,
  toClient,
} from "./axis";

/**
 * 位置引き。**キャレットがどこに立つかの判断はここに全部置く。**
 *
 * レイアウトはブラウザに任せているので、こちらは「どこに何が落ちたか」を
 * 読み返すだけ。読み返す口は `Content` 1 つで、DOM は backend が持つ。
 * おかげで折り返しの境目・二分探索・行末のぶら下がりは node のテストで縛れる。
 */

/** 位置引きが読む本文。矩形を返すのは backend で、ここは答えだけ受け取る */
export interface Content {
  /** content に流し込んだテキスト (末尾の番人を含む) */
  readonly rendered: string;
  /** offset の 1 字が占める矩形 (クライアント座標)。無ければ null */
  charRect(offset: number): Rect | null;
}

const ZERO_WIDTH_SPACE = "​";

/**
 * 末尾が改行、あるいは空だと最後の行に行ボックスが立たず、
 * キャレットの置き場が無くなる。幅ゼロの字で 1 行ぶん立てる。
 */
export function sentinelFor(text: string): string {
  return text.length === 0 || text.endsWith("\n") ? ZERO_WIDTH_SPACE : "";
}

function sentinelLength(rendered: string): number {
  return rendered.endsWith(ZERO_WIDTH_SPACE) ? 1 : 0;
}

/** 本文の長さ (末尾の番人を除く) */
export function textLength(content: Content): number {
  return content.rendered.length - sentinelLength(content.rendered);
}

/**
 * キャレットが乗る字の矩形 (クライアント座標)。
 * 直前の字の終端 (前の行の末尾) か、直後の字の先頭 (次の行の頭) かを preferEnd で選ぶ。
 */
export function caretBox(content: Content, caret: Caret): { rect: Rect; useEnd: boolean } | null {
  const { rendered } = content;
  // 改行の直後は必ず次の行の頭。折り返しと違って、前の行の末尾に着ける余地がない
  const afterBreak = rendered[caret.offset - 1] === "\n";
  const useEnd = afterBreak
    ? false
    : caret.preferEnd
      ? caret.offset > 0
      : caret.offset >= rendered.length;
  if (useEnd) {
    const rect = content.charRect(caret.offset - 1);
    if (rect) return { rect, useEnd: true };
  }
  const after = content.charRect(caret.offset);
  if (after) return { rect: after, useEnd: false };
  const before = content.charRect(caret.offset - 1);
  return before ? { rect: before, useEnd: true } : null;
}

/** キャレットの居場所 (surface 基準)。スクロール方向の厚みは持たない */
export function caretRect(axis: Axis, content: Content, caret: Caret): CaretRect {
  const { fontBox, surface } = axis;
  const box = caretBox(content, caret);

  const line = box ? lineOfRect(axis, box.rect) : 0;
  const inline = box
    ? box.useEnd
      ? inlineEndOf(axis, box.rect)
      : inlineStartOf(axis, box.rect)
    : 0;
  const at = toClient(axis, (line + 0.5) * axis.lineHeight, inline);

  return axis.vertical
    ? { x: at.x - fontBox / 2 - surface.x, y: at.y - surface.y, width: fontBox, height: 0 }
    : { x: at.x - surface.x, y: at.y - fontBox / 2 - surface.y, width: 0, height: fontBox };
}

/**
 * ハンドルの中心 (surface 基準)。選択の両端に 1 つずつ。
 * キャレットだけのときは出さない——掴めるのは選択の端だけ
 */
export function handlePoints(
  axis: Axis,
  content: Content,
  state: ViewState,
): [edge: Handle, center: HandlePoint][] {
  if (!state.handles || !state.focused) return [];
  const { selection } = state;
  if (selection.end === selection.start) return [];
  const start = caretRect(axis, content, { offset: selection.start, preferEnd: false });
  const end = caretRect(axis, content, { offset: selection.end, preferEnd: true });
  return [
    ["start", handleCenter(start, axis.vertical, "start")],
    ["end", handleCenter(end, axis.vertical, "end")],
  ];
}

/**
 * クリックした点に着けるキャレット。offset は backend が引いたもので、
 * ここが決めるのは折り返しの境目をどちらの行に着けるかだけ
 */
export function caretAtPoint(
  axis: Axis,
  content: Content,
  offset: number,
  clientX: number,
  clientY: number,
): Caret {
  const asEnd = blockOfCaret(axis, caretRect(axis, content, { offset, preferEnd: true }));
  const asStart = blockOfCaret(axis, caretRect(axis, content, { offset, preferEnd: false }));
  if (asEnd === asStart) return { offset, preferEnd: true };

  // クリックした行の側に着ける
  const at = blockOfPoint(axis, clientX, clientY);
  return { offset, preferEnd: Math.abs(at - asEnd) <= Math.abs(at - asStart) };
}

/** 行とインライン位置で順に並ぶ鍵。offset が増えれば単調に増える */
function sortKey(axis: Axis, line: number, inline: number): number {
  return line * (layerLength(axis) + 1) + inline;
}

/**
 * 指定の行の、指定のインライン位置にいちばん近いキャレット。
 *
 * caretPositionFromPoint は描かれている場所しか当たらず、
 * overflow: hidden で隠れた行に移れない。offset の並びが
 * (行, インライン位置) の順と一致することを使って二分探索する。
 */
export function caretInLine(axis: Axis, content: Content, line: number, inline: number): Caret {
  const { rendered } = content;
  const length = textLength(content);
  const target = sortKey(axis, line, inline);

  // 目標より手前で終わる字を読み飛ばす
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const rect = content.charRect(mid);
    const key = rect
      ? sortKey(axis, lineOfRect(axis, rect), inlineEndOf(axis, rect))
      : Number.POSITIVE_INFINITY;
    if (key < target) lo = mid + 1;
    else hi = mid;
  }

  const landed = content.charRect(lo);
  // 改行はその行の持ち物。次の行まで行き過ぎていたら手前に戻す
  if (!landed || lineOfRect(axis, landed) !== line) {
    const end = rendered[lo - 1] === "\n" ? lo - 1 : lo;
    return { offset: Math.min(end, length), preferEnd: true };
  }
  // 改行と末尾の番人は矩形が潰れている。字として跨がない
  if (rendered[lo] === "\n" || lo >= length) {
    return { offset: Math.min(lo, length), preferEnd: true };
  }

  // 字の後ろ半分を指していたら次の位置へ。ちょうど中点は手前
  const size = inlineSizeOf(axis, landed);
  const middle = inlineStartOf(axis, landed) + size / 2;
  const after = size > 0 && inline > middle;
  const offset = Math.min(after ? lo + 1 : lo, length);
  const next = content.charRect(offset);
  const atEnd = !next || rendered[offset] === "\n" || lineOfRect(axis, next) !== line;
  return { offset, preferEnd: atEnd };
}

/** 行を移る。縦書きでは direction 1 が左 (次の行) */
export function moveAcross(
  axis: Axis,
  content: Content,
  caret: Caret,
  direction: 1 | -1,
  goal: Goal,
  lineCount: number,
): { caret: Caret; goal: Goal } {
  const rect = caretRect(axis, content, caret);
  const distance = goal ?? inlineOfCaret(axis, rect);

  const target = lineAt(axis, blockOfCaretInLayer(axis, rect)) + direction;
  if (target < 0) return { caret: { offset: 0, preferEnd: false }, goal: distance };
  if (target >= lineCount) {
    return { caret: { offset: textLength(content), preferEnd: true }, goal: distance };
  }
  return {
    caret: caretInLine(axis, content, target, inlineInLayer(axis, distance)),
    goal: distance,
  };
}

/** 行頭 / 行末へ */
export function lineEdge(axis: Axis, content: Content, caret: Caret, edge: "start" | "end"): Caret {
  const line = lineAt(axis, blockOfCaretInLayer(axis, caretRect(axis, content, caret)));
  const inline = edge === "start" ? 0 : layerLength(axis);
  const landed = caretInLine(axis, content, line, inline);
  if (edge === "start") return { ...landed, preferEnd: false };
  return { offset: afterHangingSpace(axis, content, landed.offset, line), preferEnd: true };
}

/**
 * pre-wrap では、折り返しを起こした空白が行末にぶら下がる。
 * 内容幅の外に置かれるので二分探索では拾えない。行末はその後ろ。
 */
function afterHangingSpace(axis: Axis, content: Content, offset: number, line: number): number {
  const text = content.rendered[offset];
  if (text !== " " && text !== "\t") return offset;
  const rect = content.charRect(offset);
  if (!rect || lineOfRect(axis, rect) !== line) return offset;
  return Math.min(offset + 1, textLength(content));
}

/**
 * レイアウトされた行の間隔。測れなければ fallback を返す。
 *
 * **これだけ Axis を受けない**——行送りを決めるのがこの関数なので、
 * まだ Axis を組めていない。
 */
export function pitchOf(vertical: boolean, rects: readonly Rect[], fallback: number): number {
  // 行が 2 本見つかれば足りる
  if (rects.length < 2) return fallback;

  // **端数を落とさない。**16px × 1.8 = 28.8 のように 1/4px に乗らない値が普通にあり、
  // 丸めると 1 行あたり 0.05px の系統誤差になる。列は「行番号 × 行送り」で置くので、
  // 行が進むほど横へずれていく (100 行で字の 3 分の 1)
  const centers = rects
    .map((rect) => (vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2))
    .sort((a, b) => a - b);

  // 同じ行に複数の断片が出ることがある。1px 以内は同じ行とみなす
  const lines: number[] = [];
  for (const center of centers) {
    if (lines.length === 0 || center - lines[lines.length - 1] > 1) lines.push(center);
  }
  if (lines.length < 2) return fallback;

  // 空行は行 2 つぶんの隙間を作る。いちばん狭い隙間が行 1 つぶん
  let unit = Number.POSITIVE_INFINITY;
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i] - lines[i - 1];
    if (gap > 1 && gap < unit) unit = gap;
  }
  if (!Number.isFinite(unit)) return fallback;

  // 端から端までを行数で割り直す。1 本ぶんの測り誤差を均す
  const span = lines[lines.length - 1] - lines[0];
  const count = Math.round(span / unit);
  return count > 0 ? span / count : unit;
}
