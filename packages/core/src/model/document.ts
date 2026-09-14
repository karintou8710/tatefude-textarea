import { stepGrapheme, stepWord } from "../text/segment";
import type { Selection } from "../types";
import type { EditKind, Snapshot } from "./history";
import { History } from "./history";
import type { Caret, Goal } from "./movement";

/**
 * 本文・選択・履歴。
 *
 * DOM を一切見ない。組み方も描き方も知らないので、node のテストで回せる。
 * 画面を触るのは呼び手の仕事で、ここは「変わったかどうか」だけを返す。
 * 変わらなかったときに描き直さないのは、キャレットの点滅を飛ばさないため。
 */
export class TextDocument {
  private body = "";
  private anchor = 0;
  private head: Caret = { offset: 0, preferEnd: false };
  private aim: Goal = null;
  private history = new History();

  constructor(text = "") {
    this.body = normalize(text);
  }

  get text(): string {
    return this.body;
  }

  get length(): number {
    return this.body.length;
  }

  get caret(): Caret {
    return this.head;
  }

  get goal(): Goal {
    return this.aim;
  }

  get selection(): Selection {
    return { anchor: this.anchor, focus: this.head.offset };
  }

  /** 選択範囲を前後の順に揃えて返す */
  range(): [number, number] {
    const a = this.anchor;
    const b = this.head.offset;
    return a <= b ? [a, b] : [b, a];
  }

  get selectedText(): string {
    const [from, to] = this.range();
    return this.body.slice(from, to);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** ここで切ると、次の編集は前のとまとまらない */
  breakCoalescing(): void {
    this.history.breakCoalescing();
  }

  /**
   * 中身を丸ごと入れ替える。戻り値は本文か選択が動いたか。
   * 履歴を残すかは呼び手が決める
   */
  reset(text: string, selection?: Selection, keepHistory = false): boolean {
    const next = normalize(text);
    if (next === this.body && !selection) return false;
    if (!keepHistory) this.history.clear();

    this.body = next;
    this.place(selection ?? this.selection);
    return true;
  }

  setSelection(anchor: number, focus = anchor): void {
    this.place({ anchor, focus });
    this.history.breakCoalescing();
  }

  selectAll(): void {
    this.setSelection(0, this.body.length);
  }

  /** キャレットを動かす。extend なら掴んだ側を置いたまま伸ばす */
  moveCaret(caret: Caret, extend: boolean, goal: Goal = null): void {
    this.head = caret;
    this.aim = goal;
    if (!extend) this.anchor = caret.offset;
    this.history.breakCoalescing();
  }

  /**
   * 範囲を差し替える。戻り値は本文が動いたか。
   * maxLength は options 由来なので、こちらは知らずに受け取る
   */
  replace(from: number, to: number, insert: string, kind: EditKind, maxLength: number): boolean {
    const room = maxLength - (this.body.length - (to - from));
    const text = room >= insert.length ? insert : insert.slice(0, Math.max(0, room));
    if (from === to && text.length === 0) return false;

    this.history.push({ text: this.body, selection: this.selection }, kind);
    this.body = this.body.slice(0, from) + text + this.body.slice(to);

    const at = from + text.length;
    this.anchor = at;
    this.head = { offset: at, preferEnd: false };
    this.aim = null;
    return true;
  }

  /** 選択があればそれを、無ければ 1 つぶん消す */
  deleteBy(direction: 1 | -1, byWord: boolean, maxLength: number): boolean {
    const [from, to] = this.range();
    if (from !== to) return this.replace(from, to, "", "delete", maxLength);

    const at = this.head.offset;
    const other = byWord
      ? stepWord(this.body, at, direction)
      : stepGrapheme(this.body, at, direction);
    if (other === at) return false;
    return this.replace(Math.min(at, other), Math.max(at, other), "", "delete", maxLength);
  }

  undo(): boolean {
    return this.restore(this.history.undo(this.snapshot()));
  }

  redo(): boolean {
    return this.restore(this.history.redo(this.snapshot()));
  }

  private snapshot(): Snapshot {
    return { text: this.body, selection: this.selection };
  }

  private restore(snapshot: Snapshot | null | undefined): boolean {
    if (!snapshot) return false;
    this.body = snapshot.text;
    this.place(snapshot.selection);
    return true;
  }

  /** 本文の長さに収めて置く。移動の目標は、置き直したら用済み */
  private place(selection: Selection): void {
    this.anchor = clamp(selection.anchor, 0, this.body.length);
    this.head = { offset: clamp(selection.focus, 0, this.body.length), preferEnd: false };
    this.aim = null;
  }
}

/** 改行を \n に揃える。textarea が外から受け取る値は CRLF のことがある */
export function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
