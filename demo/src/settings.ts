import type { CSSProperties } from "react";
import type { WritingMode } from "tatefude-textarea";

export const fonts = [
  { label: "明朝", value: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif' },
  { label: "ゴシック", value: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif' },
];

/** つまみで動かせるもの。writingMode 以外はすべて CSS に落ちる */
export interface Settings {
  size: number;
  lineHeight: number;
  family: string;
  kinsoku: boolean;
  writingMode: WritingMode;
}

export const defaultSettings: Settings = {
  size: 16,
  lineHeight: 1.8,
  family: fonts[0].value,
  kinsoku: true,
  writingMode: "vertical-rl",
};

/**
 * 寸法とレイアウトはエディタがコンテナの計算スタイルから読む。
 * つまみで動かすので、クラスではなく直接当てる。
 */
export function editorStyle({ family, size, lineHeight, kinsoku }: Settings): CSSProperties {
  return {
    fontFamily: family,
    fontSize: `${size}px`,
    lineHeight,
    padding: 24,
    lineBreak: kinsoku ? "strict" : "loose",
  };
}
