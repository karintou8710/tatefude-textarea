import { describe, expect, it } from "vitest";
import { newScreenState, setFocused, showHandles } from "./screen";

describe("画面の状態", () => {
  it("動かなければ同じものを返す。描き直しを省くため", () => {
    expect(showHandles(newScreenState, false)).toBe(newScreenState);
    expect(setFocused(newScreenState, false)).toBe(newScreenState);
  });

  it("元の state は書き換わらない", () => {
    const focused = setFocused(newScreenState, true);
    expect(focused.focused).toBe(true);
    expect(newScreenState.focused).toBe(false);
  });

  it("focus を失ったらハンドルも引っ込める", () => {
    const touched = showHandles(setFocused(newScreenState, true), true);
    expect(touched.handles).toBe(true);
    expect(setFocused(touched, false).handles).toBe(false);
  });
});
