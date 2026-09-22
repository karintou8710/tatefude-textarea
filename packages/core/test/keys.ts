import { server } from "@vitest/browser/context";

/**
 * 修飾キーはこの OS のネイティブに合わせてある → [docs/spec/key.md](../../../docs/spec/key.md)。
 * テストも同じ分岐を持つ。ここを 1 箇所にまとめて、打ち方の違いを本体に散らさない。
 */
export const mac = server.platform === "darwin";

/** 語・段落ぶん動かす。macOS は ⌥、それ以外は Ctrl */
export const byUnit: KeyboardEventInit = mac ? { altKey: true } : { ctrlKey: true };

/** 本文の端へ飛ばす打ち方。macOS は ⌘ + ブロック方向、それ以外は Ctrl + Home / End */
export function toDocEdge(
  edge: "start" | "end",
  lines: { nextLine: string; prevLine: string },
): [string, KeyboardEventInit] {
  if (mac) return [edge === "end" ? lines.nextLine : lines.prevLine, { metaKey: true }];
  return [edge === "end" ? "End" : "Home", { ctrlKey: true }];
}
