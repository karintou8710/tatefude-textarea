import type { CaretRect } from "./backend";

/** つまみの丸の半径 (CSS px) */
export const HANDLE_RADIUS = 6;

/** 指で掴める広さ。見た目より大きく取る (CSS px) */
const GRAB = 24;

export interface HandlePoint {
  x: number;
  y: number;
}

/**
 * つまみの丸の中心。キャレットの棒から、選択の外側へ行送り方向に押し出す。
 * 横書きなら始点が上・終点が下、縦書きなら始点が右 (行の始まる側)・終点が左
 */
export function handleCenter(
  rect: CaretRect,
  vertical: boolean,
  edge: "start" | "end",
): HandlePoint {
  if (vertical) {
    return {
      x: edge === "start" ? rect.x + rect.width + HANDLE_RADIUS : rect.x - HANDLE_RADIUS,
      y: rect.y,
    };
  }
  return {
    x: rect.x,
    y: edge === "start" ? rect.y - HANDLE_RADIUS : rect.y + rect.height + HANDLE_RADIUS,
  };
}

/** 指がつまみに乗っているか */
export function grabsHandle(center: HandlePoint, x: number, y: number): boolean {
  return Math.abs(center.x - x) <= GRAB / 2 && Math.abs(center.y - y) <= GRAB / 2;
}
