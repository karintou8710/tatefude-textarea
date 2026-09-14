import type { Selection } from "../types";

export interface Snapshot {
  text: string;
  selection: Selection;
}

/** 連続した同じ種類の編集をひとまとめにする時間 */
const COALESCE_MS = 700;
const MAX_DEPTH = 500;

export type EditKind = "input" | "delete" | "other";

export class History {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private lastKind: EditKind = "other";
  private lastAt = 0;

  /** 編集する前の状態を積む */
  push(before: Snapshot, kind: EditKind, now = Date.now()): void {
    this.future.length = 0;

    const coalesce =
      this.past.length > 0 &&
      kind !== "other" &&
      kind === this.lastKind &&
      now - this.lastAt < COALESCE_MS;

    this.lastKind = kind;
    this.lastAt = now;
    if (coalesce) return;

    this.past.push(before);
    if (this.past.length > MAX_DEPTH) this.past.shift();
  }

  /** まとめる窓を閉じる。選択の移動やフォーカス移動のあとに呼ぶ */
  breakCoalescing(): void {
    this.lastKind = "other";
  }

  undo(current: Snapshot): Snapshot | null {
    const snapshot = this.past.pop();
    if (!snapshot) return null;
    this.future.push(current);
    this.breakCoalescing();
    return snapshot;
  }

  redo(current: Snapshot): Snapshot | null {
    const snapshot = this.future.pop();
    if (!snapshot) return null;
    this.past.push(current);
    this.breakCoalescing();
    return snapshot;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.breakCoalescing();
  }
}
