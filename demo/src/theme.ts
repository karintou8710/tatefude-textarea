import type { Theme } from "tatefude-textarea";

/**
 * 色だけは CSS から読めないので、配色を JS 側でも持つ。
 * 地と枠は global.css の CSS 変数、本文まわりはここ。
 */
export const lightTheme = {
  text: "#1a1a1a",
  placeholder: "#a8a29a",
  caret: "#1a1a1a",
  selection: "#b9d8f7",
  selectionInactive: "#e0ddd6",
  composition: "#1a1a1a",
  compositionActive: "#2563eb",
} satisfies Partial<Theme>;

export const darkTheme = {
  text: "#ece7dd",
  placeholder: "#6b665d",
  caret: "#ece7dd",
  selection: "#2f4c6b",
  selectionInactive: "#2b2822",
  composition: "#ece7dd",
  compositionActive: "#7aa7ff",
} satisfies Partial<Theme>;
