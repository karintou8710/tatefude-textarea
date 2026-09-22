import { describe, expect, it } from "vitest";
import {
  type GestureEffect,
  type GestureState,
  newGestureState,
  onPointer,
  type PointerInput,
} from "./gesture";

/** 出来事を順に流して、最後の状態と、出たことを全部集める */
function play(inputs: PointerInput[], from: GestureState = newGestureState) {
  let state = from;
  const effects: GestureEffect[] = [];
  for (const input of inputs) {
    const result = onPointer(state, input);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects, types: effects.map((e) => e.type) };
}

const touch = (over: Partial<Extract<PointerInput, { type: "down" }>> = {}) =>
  ({
    type: "down",
    id: 1,
    x: 100,
    y: 100,
    at: 1000,
    touch: true,
    shift: false,
    handle: null,
    ...over,
  }) satisfies PointerInput;

describe("マウス", () => {
  it("押したら掴んで、キャレットを置く。focus は最後", () => {
    const { state, types } = play([touch({ touch: false })]);
    expect(types).toEqual(["forgetAnchor", "showHandles", "capture", "placeCaret", "focus"]);
    expect(state.drag).toEqual({ extend: true, by: "char" });
  });

  it("触り直したら指のハンドルは引っ込める", () => {
    const { effects } = play([touch({ touch: false })]);
    expect(effects[1]).toEqual({ type: "showHandles", show: false });
  });

  it("回数は自分で数える。PointerEvent.detail は常に 0 なので当てにできない", () => {
    const mouse = (over = {}) => touch({ touch: false, ...over });
    const twice = play([mouse(), mouse({ at: 1100 })]);
    expect(twice.types).toContain("selectWord");
    expect(twice.state.taps).toBe(2);

    const thrice = play([mouse(), mouse({ at: 1100 }), mouse({ at: 1200 })]);
    expect(thrice.types).toContain("selectParagraph");
  });

  it("2 回目・3 回目のあとは、そのまま語・段落ごとにドラッグできる", () => {
    const mouse = (over = {}) => touch({ touch: false, ...over });
    expect(play([mouse(), mouse({ at: 1100 })]).state.drag).toEqual({ extend: true, by: "word" });
    expect(play([mouse(), mouse({ at: 1100 }), mouse({ at: 1200 })]).state.drag).toEqual({
      extend: true,
      by: "paragraph",
    });
  });

  it("500ms 以上あいたら 1 回目に戻る", () => {
    const mouse = (over = {}) => touch({ touch: false, ...over });
    const apart = play([mouse(), mouse({ at: 1600 })]);
    expect(apart.types).not.toContain("selectWord");
    expect(apart.state.drag).toEqual({ extend: true, by: "char" });
  });

  it("隣の字を続けて押しても語にはならない。指より許すずれが狭い", () => {
    // 全角 1 字は 16px 前後。指と同じ 24px を許すと、別の字を押しただけで語が選ばれる
    const mouse = (over = {}) => touch({ touch: false, ...over });
    const next = play([mouse(), mouse({ at: 1100, y: 116 })]);
    expect(next.types).not.toContain("selectWord");

    // 同じ場所ならダブルクリックになる
    const same = play([mouse(), mouse({ at: 1100, y: 102 })]);
    expect(same.types).toContain("selectWord");
  });

  it("shift を押していたら伸ばす", () => {
    const { effects } = play([touch({ touch: false, shift: true })]);
    expect(effects).toContainEqual({
      type: "placeCaret",
      x: 100,
      y: 100,
      extend: true,
      by: "char",
    });
  });
});

describe("指: タップ", () => {
  it("押した時点では focus を入れない。スワイプしただけでキーボードが出てしまう", () => {
    const { types } = play([touch()]);
    expect(types).toEqual(["forgetAnchor", "cancelLongPress", "waitLongPress"]);
    expect(types).not.toContain("focus");
  });

  it("動かずに離したら、置いて・ハンドルを出して・focus", () => {
    const { types } = play([touch(), { type: "up", id: 1, x: 100, y: 100, shift: false }]);
    expect(types).toEqual([
      "forgetAnchor",
      "cancelLongPress",
      "waitLongPress",
      "cancelLongPress",
      "placeCaret",
      "showHandles",
      "focus",
    ]);
  });

  it("少しなら動いてもタップした扱い (8px まで)", () => {
    const { types } = play([touch(), { type: "up", id: 1, x: 108, y: 100, shift: false }]);
    expect(types).toContain("placeCaret");
  });

  it("8px を超えて動いたらスクロール。置き直さない", () => {
    const { types, state } = play([
      touch(),
      { type: "move", id: 1, x: 109, y: 100 },
      { type: "up", id: 1, x: 109, y: 100, shift: false },
    ]);
    expect(types).not.toContain("placeCaret");
    expect(types).not.toContain("focus");
    expect(state.tap).toBe(null);
  });

  it("別の指の動きは見ない", () => {
    const { state } = play([touch(), { type: "move", id: 2, x: 300, y: 300 }]);
    expect(state.tap).toEqual({ id: 1, x: 100, y: 100 });
  });
});

describe("指: 連続タップ", () => {
  const second = (over: Partial<Extract<PointerInput, { type: "down" }>> = {}) =>
    touch({ at: 1200, ...over });

  it("2 回目で語を選び、そのままドラッグできる", () => {
    const { state, types } = play([
      touch(),
      { type: "up", id: 1, x: 100, y: 100, shift: false },
      second(),
    ]);
    expect(types).toContain("selectWord");
    expect(state.drag).toEqual({ extend: true, by: "word" });
    expect(state.taps).toBe(2);
  });

  it("3 回目は段落", () => {
    const { types } = play([
      touch(),
      { type: "up", id: 1, x: 100, y: 100, shift: false },
      second(),
      { type: "up", id: 1, x: 100, y: 100, shift: false },
      touch({ at: 1400 }),
    ]);
    expect(types.filter((t) => t === "selectParagraph")).toHaveLength(1);
  });

  it("300ms 以上あいたら 1 回目に戻る", () => {
    const { state, types } = play([
      touch(),
      { type: "up", id: 1, x: 100, y: 100, shift: false },
      second({ at: 1300 }),
    ]);
    expect(state.taps).toBe(1);
    expect(types).not.toContain("selectWord");
  });

  it("24px 以上離れていたら 1 回目に戻る", () => {
    const { state } = play([
      touch(),
      { type: "up", id: 1, x: 100, y: 100, shift: false },
      second({ x: 125 }),
    ]);
    expect(state.taps).toBe(1);
  });

  it("スワイプしたら続けてタップした数も切れる", () => {
    const { state } = play([
      touch(),
      { type: "move", id: 1, x: 200, y: 100 },
      { type: "up", id: 1, x: 200, y: 100, shift: false },
      second(),
    ]);
    expect(state.taps).toBe(1);
  });
});

describe("指: 長押し", () => {
  it("時間が来たら掴む。離しても置き直さない", () => {
    const { state, types } = play([touch(), { type: "longPress", id: 1, x: 100, y: 100 }]);
    expect(types.slice(-4)).toEqual(["placeCaret", "showHandles", "focus", "capture"]);
    expect(state.drag).toEqual({ extend: false, by: "char" });
    expect(state.tap).toBe(null);
  });

  it("引き回すときはキャレットごと動く", () => {
    const { effects } = play([
      touch(),
      { type: "longPress", id: 1, x: 100, y: 100 },
      { type: "move", id: 1, x: 140, y: 100 },
    ]);
    expect(effects).toContainEqual({
      type: "placeCaret",
      x: 140,
      y: 100,
      extend: false,
      by: "char",
    });
  });

  it("指を離したあとに時間が来ても何もしない", () => {
    const { types } = play([
      touch(),
      { type: "up", id: 1, x: 100, y: 100, shift: false },
      { type: "longPress", id: 1, x: 100, y: 100 },
    ]);
    expect(types.filter((t) => t === "focus")).toHaveLength(1);
  });
});

describe("指: ハンドル", () => {
  it("押した時点で掴む。タップした扱いにはしない", () => {
    const { state, types } = play([touch({ handle: "start" })]);
    expect(types).toEqual(["forgetAnchor", "cancelLongPress", "grabHandle", "capture"]);
    expect(state.drag).toEqual({ extend: true, by: "char" });
    expect(state.tap).toBe(null);
  });

  it("掴んだあとは端を伸ばすだけ", () => {
    const { effects } = play([touch({ handle: "end" }), { type: "move", id: 1, x: 160, y: 100 }]);
    expect(effects).toContainEqual({
      type: "placeCaret",
      x: 160,
      y: 100,
      extend: true,
      by: "char",
    });
  });
});

describe("やめる", () => {
  it("ブラウザがパンを取ったら、掴みもタップも捨てる", () => {
    const { state, types } = play([touch({ handle: "start" }), { type: "cancel", id: 1 }]);
    expect(state.drag).toBe(null);
    expect(state.tap).toBe(null);
    expect(types).toContain("release");
  });

  it("掴んでいなければ離す指示は出さない", () => {
    const { types } = play([touch(), { type: "up", id: 1, x: 100, y: 100, shift: false }]);
    expect(types).not.toContain("release");
  });
});
