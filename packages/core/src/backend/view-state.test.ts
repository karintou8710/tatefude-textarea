import { describe, expect, it } from "vitest";
import type { ViewContent } from "../state/query";
import type { ScreenState } from "../state/screen";
import { buildViewState } from "./view-state";

function content(partial: Partial<ViewContent> = {}): ViewContent {
  return {
    text: "あいうえお",
    selection: { start: 0, end: 0 },
    caret: { offset: 0, preferEnd: false },
    collapsed: true,
    composing: false,
    composition: null,
    empty: false,
    ...partial,
  };
}

function screen(partial: Partial<ScreenState> = {}): ScreenState {
  return { focused: true, handles: false, ...partial };
}

describe("キャレット", () => {
  it("選択が伸びている間は出さない", () => {
    expect(buildViewState(content({ collapsed: false }), screen(), "").caretVisible).toBe(false);
  });
});

describe("placeholder", () => {
  it("本文が空のときだけ出す", () => {
    expect(buildViewState(content({ empty: true }), screen(), "書く").placeholder).toBe("書く");
    expect(buildViewState(content(), screen(), "書く").placeholder).toBe(null);
  });
});

describe("変換中", () => {
  const composing = content({
    composing: true,
    selection: { start: 1, end: 3 },
    empty: true,
  });

  it("選択とつまみは出さない", () => {
    const state = buildViewState(composing, screen({ handles: true }), "");
    expect(state.selection).toEqual({ start: 0, end: 0 });
    expect(state.handles).toBe(false);
  });

  it("本文が空でも placeholder を出さない", () => {
    expect(buildViewState(composing, screen(), "書く").placeholder).toBe(null);
  });
});
