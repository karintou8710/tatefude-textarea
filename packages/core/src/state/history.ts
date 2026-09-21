import type { Selection } from "../types";

export interface Snapshot {
  readonly text: string;
  readonly selection: Selection;
}

/** 連続した同じ種類の編集をひとまとめにする時間 */
const COALESCE_MS = 700;
const MAX_DEPTH = 500;

export type EditKind = "input" | "delete" | "other";

/**
 * 戻せる場所の積み上げ。作り直すだけで、書き換えない。
 *
 * `lastKind` と `lastAt` は「いまのまとまりが何で、いつだったか」。
 * 続けて同じ種類を打っている間は積まないので、まとめて戻る。
 */
export interface HistoryState {
  readonly past: readonly Snapshot[];
  readonly future: readonly Snapshot[];
  readonly lastKind: EditKind;
  readonly lastAt: number;
}

export const emptyHistory: HistoryState = {
  past: [],
  future: [],
  lastKind: "other",
  lastAt: 0,
};

/** 編集する前の状態を積む */
export function push(
  history: HistoryState,
  before: Snapshot,
  kind: EditKind,
  now = Date.now(),
): HistoryState {
  const coalesce =
    history.past.length > 0 &&
    kind !== "other" &&
    kind === history.lastKind &&
    now - history.lastAt < COALESCE_MS;

  const past = coalesce ? history.past : [...history.past, before].slice(-MAX_DEPTH);
  return { past, future: [], lastKind: kind, lastAt: now };
}

/** まとめる窓を閉じる。選択の移動や focus の移動のあとに呼ぶ */
export function breakCoalescing(history: HistoryState): HistoryState {
  if (history.lastKind === "other") return history;
  return { ...history, lastKind: "other" };
}

export function undo(
  history: HistoryState,
  current: Snapshot,
): { history: HistoryState; snapshot: Snapshot } | null {
  const snapshot = history.past[history.past.length - 1];
  if (!snapshot) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      lastKind: "other",
      lastAt: history.lastAt,
    },
    snapshot,
  };
}

export function redo(
  history: HistoryState,
  current: Snapshot,
): { history: HistoryState; snapshot: Snapshot } | null {
  const snapshot = history.future[history.future.length - 1];
  if (!snapshot) return null;
  return {
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      lastKind: "other",
      lastAt: history.lastAt,
    },
    snapshot,
  };
}
