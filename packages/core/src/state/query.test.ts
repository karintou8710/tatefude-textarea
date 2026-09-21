import { describe, expect, it } from "vitest";
import { setSelection } from "../edit/selection";
import { newEditState } from "./edit";
import { viewContent } from "./query";

describe("画面に出す中身", () => {
  it("選択が潰れているかを伝える", () => {
    const state = newEditState("あいうえお");
    expect(viewContent(state).collapsed).toBe(true);

    const selected = setSelection(state, 1, 3).state;
    expect(viewContent(selected).collapsed).toBe(false);
    expect(viewContent(selected).selection).toEqual({ start: 1, end: 3 });
  });

  it("選択は前後の順に揃える", () => {
    const state = setSelection(newEditState("あいうえお"), 4, 1).state;
    expect(viewContent(state).selection).toEqual({ start: 1, end: 4 });
  });

  it("本文が空かどうかを伝える", () => {
    expect(viewContent(newEditState("")).empty).toBe(true);
    expect(viewContent(newEditState("あ")).empty).toBe(false);
  });
});
