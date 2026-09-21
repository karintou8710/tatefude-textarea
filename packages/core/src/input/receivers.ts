import type { WritingMode } from "../types";

/**
 * DOM の入力を、繋ぐ側から見た形。
 *
 * `textarea.ts` が叩けるものをここに絞る。実装は 1 つずつしか無いので
 * 差し替えるためではなく、**繋ぐ側が何に依っているかを見せるため**の型。
 */

/**
 * 隠し入力が読む設定。`ResolvedOptions` をそのまま渡せるが、型はこちらで持つ
 * ——options が増えても、隠し入力が読めるものは増えない
 */
export interface InputOptions {
  /** 矢印の向きを決める。縦書きなら ↑↓ が字送り */
  writingMode: WritingMode;
  readOnly: boolean;
  disabled: boolean;
}

/** 隠し入力。キー・IME・クリップボード・focus を受ける */
export interface Input {
  setOptions(options: InputOptions): void;
  focus(): void;
  blur(): void;
  /** キャレットの脇へ置き直す */
  followCaret(): void;
  destroy(): void;
}

/** 指とマウス */
export interface Pointer {
  /** focus を失ったらドラッグも終わり */
  cancelDrag(): void;
  destroy(): void;
}
