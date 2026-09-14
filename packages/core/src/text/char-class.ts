/**
 * 縦書きにしたときの字の置き方。
 * UAX #50 (Unicode Vertical Text Layout) の分類を、canvas で再現できる 3 種類に潰したもの。
 */
export type Orientation =
  /** そのまま正立。全角の送り量を取る */
  | "upright"
  /** 時計回りに 90 度倒す。送り量は横書きでの字幅 */
  | "rotate"
  /** 正立させたうえで、字面を em ボックスの右上へ寄せる (、。) */
  | "corner";

const ROTATED = new Set([
  // 括弧・約物。回すと縦組みの字形になる
  ..."（）｛｝［］〈〉《》「」『』【】〔〕〖〗〘〙〚〛",
  ..."()[]{}<>",
  // 引く線・つなぐ線
  ..."ー〜～…‥–—―‐−﹘",
  // 縦組みでは横倒しになる約物
  ..."：；＝≒≠＜＞≦≧＋－×÷",
  ..."~=+<>",
]);

const CORNER = new Set(["、", "。", "，", "．", "､", "｡"]);

const SMALL_KANA = new Set([..."ぁぃぅぇぉっゃゅょゎゕゖ", ..."ァィゥェォッャュョヮヵヶ"]);

/** 行頭に置けない字 (行頭禁則) */
const LINE_START_FORBIDDEN = new Set([
  ..."、。，．,.:;：；!?！？",
  ..."）］｝〉》」』】〕〗〙〛)]}>",
  ..."ー〜～…‥–—―",
  ..."ぁぃぅぇぉっゃゅょゎゕゖ",
  ..."ァィゥェォッャュョヮヵヶ",
  ..."ゝゞヽヾ々〻・‐",
  ..."”’〟",
]);

/** 行末に置けない字 (行末禁則) */
const LINE_END_FORBIDDEN = new Set([..."（［｛〈《「『【〔〖〘〚([{<", ..."“‘〝"]);

export function orientationOf(ch: string): Orientation {
  if (CORNER.has(ch)) return "corner";
  if (ROTATED.has(ch)) return "rotate";

  const code = ch.codePointAt(0) ?? 0;

  // 半角のラテン・数字・記号と、ギリシャ・キリルはまとめて横倒し
  if (code < 0x0300) return "rotate";
  if (code >= 0x0370 && code <= 0x04ff) return "rotate";

  // 全角英数・仮名・漢字・halfwidth katakana はそのまま立てる
  return "upright";
}

export function isSmallKana(ch: string): boolean {
  return SMALL_KANA.has(ch);
}

export function isLineStartForbidden(ch: string): boolean {
  return LINE_START_FORBIDDEN.has(ch);
}

export function isLineEndForbidden(ch: string): boolean {
  return LINE_END_FORBIDDEN.has(ch);
}

/** 途中で折り返したくないラテン語の綴り */
export function isLatinWordChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    ch === "'" ||
    ch === "-"
  );
}
