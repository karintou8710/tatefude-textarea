import { describe, expect, it, vi } from "vitest";
import { type EditState, type Limits, newEditState } from "../state/edit";
import { selection } from "../state/query";
import { breakCoalescing, setSelection } from "./selection";
import { cut, deleteBy, deleteSelection, insert, redo, replaceAt, reset, undo } from "./text";

const open: Limits = { editable: true, maxLength: Number.POSITIVE_INFINITY };
const locked: Limits = { editable: false, maxLength: Number.POSITIVE_INFINITY };

function at(text: string, anchor: number, focus = anchor): EditState {
  return setSelection(newEditState(text), anchor, focus).state;
}

describe("差し込む", () => {
  it("入れた字の後ろにキャレットが来る", () => {
    const result = insert(at("あいう", 1, 2), "XY", open);
    expect(result.changed).toBe("edit");
    expect(result.state.text).toBe("あXYう");
    expect(selection(result.state)).toEqual({ anchor: 3, head: 3 });
  });

  it("元の state は書き換わらない", () => {
    const before = at("あいう", 1, 2);
    insert(before, "XY", open);
    expect(before.text).toBe("あいう");
    expect(selection(before)).toEqual({ anchor: 1, head: 2 });
  });

  it("何も入らないなら元の state をそのまま返す。描き直しを省くため", () => {
    const before = at("あいう", 1);
    const result = insert(before, "", open);
    expect(result.changed).toBe(null);
    expect(result.state).toBe(before);
  });

  it("改行は \\n に揃える", () => {
    expect(insert(newEditState(""), "あ\r\nい\rう", open).state.text).toBe("あ\nい\nう");
    expect(newEditState("あ\r\nい").text).toBe("あ\nい");
  });

  it("maxLength を超えるぶんは切る", () => {
    // 上限 4、本文 2 文字なので、入るのは 2 文字だけ
    const result = insert(at("あい", 2), "うえお", { editable: true, maxLength: 4 });
    expect(result.state.text).toBe("あいうえ");
  });

  it("空きに収まらない書記素は入れない。割ると壊れた文字が残る", () => {
    // 𠮷 はサロゲートペアで 2 コード単位。空き 1 には入らない
    const result = insert(newEditState(""), "𠮷", { editable: true, maxLength: 1 });
    expect(result.state.text).toBe("");
    expect(result.changed).toBe(null);
  });

  it("結合列の途中では切らない", () => {
    // か + 濁点 で 2。空き 2 なら入る
    expect(
      insert(newEditState(""), "か\u3099き", { editable: true, maxLength: 2 }).state.text,
    ).toBe("か\u3099");
    // 空き 1 では濁点が付かないので、か だけ残さない
    expect(
      insert(newEditState(""), "か\u3099き", { editable: true, maxLength: 1 }).state.text,
    ).toBe("");
  });

  it("選択を潰して入れるときは、消えるぶんが空きに戻る", () => {
    // 5 文字中 3 文字を消して入れるので、上限 5 でも 3 文字入る
    const result = insert(at("あいうえお", 1, 4), "XYZ", { editable: true, maxLength: 5 });
    expect(result.state.text).toBe("あXYZお");
  });

  it("範囲の差し替えは選択を見ない。変換だけが通る", () => {
    const result = replaceAt(at("あいうえお", 3, 5), 1, 3, "×", open);
    expect(result.state.text).toBe("あ×えお");
  });

  it("打ち込めないなら本文を触らない", () => {
    const before = at("あいうえお", 1, 3);
    expect(insert(before, "×", locked).state).toBe(before);
    expect(replaceAt(before, 1, 2, "×", locked).state).toBe(before);
    expect(deleteSelection(before, locked).state).toBe(before);
    expect(deleteBy(before, -1, false, locked).state).toBe(before);
  });
});

describe("消す", () => {
  it("選択があれば、向きに関わらずそれを消す", () => {
    for (const direction of [1, -1] as const) {
      const result = deleteBy(at("あいうえお", 1, 4), direction, false, open);
      expect(result.changed).toBe("edit");
      expect(result.state.text).toBe("あお");
    }
  });

  it("選択が無ければ書記素 1 つぶん。結合文字はまとめて消える", () => {
    // か + 濁点 + き。濁点だけ残さない
    const result = deleteBy(at("か\u3099き", 2), -1, false, open);
    expect(result.state.text).toBe("き");
  });

  it("端では何も動かない", () => {
    expect(deleteBy(at("あい", 0), -1, false, open).changed).toBe(null);
    expect(deleteBy(at("あい", 2), 1, false, open).changed).toBe(null);
  });

  it("選択が無ければ切り取っても何も起きない", () => {
    expect(cut(at("あいうえお", 1), open)).toMatchObject({ text: "", changed: null });
  });
});

describe("切り取る", () => {
  it("消したあとの state と、消す前の文字列を返す", () => {
    const result = cut(at("あいうえお", 1, 3), open);
    expect(result.text).toBe("いう");
    expect(result.changed).toBe("edit");
    expect(result.state.text).toBe("あえお");
  });

  it("打ち込めないなら文字列だけ返して消さない", () => {
    const before = at("あいうえお", 1, 3);
    const result = cut(before, locked);
    expect(result.text).toBe("いう");
    expect(result.changed).toBe(null);
    expect(result.state).toBe(before);
  });
});

describe("履歴", () => {
  it("戻すと本文も選択も戻る", () => {
    const before = at("あいう", 3);
    const typed = insert(before, "えお", open).state;
    expect(typed.text).toBe("あいうえお");

    const back = undo(typed);
    expect(back.changed).toBe("edit");
    expect(back.state.text).toBe("あいう");
    expect(selection(back.state)).toEqual({ anchor: 3, head: 3 });

    expect(redo(back.state).state.text).toBe("あいうえお");
  });

  it("戻せるものが無ければ元の state をそのまま返し、changed も立てない", () => {
    const before = newEditState("あ");
    expect(undo(before).state).toBe(before);
    expect(redo(before).state).toBe(before);
    // 「戻せるか」はこれで分かる。可否を state に持たない理由
    expect(undo(before).changed).toBeNull();
    expect(redo(before).changed).toBeNull();

    const typed = insert(setSelection(before, 1).state, "い", open).state;
    expect(undo(typed).changed).not.toBeNull();
    expect(redo(undo(typed).state).changed).not.toBeNull();
  });

  it("続けて打った字はひとまとめに戻る", () => {
    let state = newEditState("");
    state = insert(state, "あ", open).state;
    state = insert(state, "い", open).state;
    expect(undo(state).state.text).toBe("");
  });

  it("区切ると別々に戻る", () => {
    let state = newEditState("");
    state = insert(state, "あ", open).state;
    state = breakCoalescing(state);
    state = insert(state, "い", open).state;
    expect(undo(state).state.text).toBe("あ");
  });

  it("しばらく置いたら別々に戻る", () => {
    // まとまる窓は 700ms。跨いだら別の山になる
    vi.useFakeTimers();
    try {
      let state = newEditState("");
      state = insert(state, "あ", open).state;
      vi.advanceTimersByTime(800);
      state = insert(state, "い", open).state;
      expect(undo(state).state.text).toBe("あ");
    } finally {
      vi.useRealTimers();
    }
  });

  it("打つのと消すのはまとまらない", () => {
    let state = insert(newEditState(""), "あい", open).state;
    state = deleteBy(state, -1, false, open).state;
    expect(state.text).toBe("あ");
    expect(undo(state).state.text).toBe("あい");
  });
});

describe("入れ替える", () => {
  it("同じ本文で選択も指定しなければ動かない", () => {
    const before = newEditState("あいう");
    expect(reset(before, "あいう").changed).toBe(null);
  });

  it("同じ本文でも、選択を指定すれば動いたことにする", () => {
    const result = reset(newEditState("あいう"), "あいう", { anchor: 1, head: 2 });
    expect(result.changed).toBe("edit");
    expect(selection(result.state)).toEqual({ anchor: 1, head: 2 });
  });

  it("既定では履歴を捨てる", () => {
    const typed = insert(at("あ", 1), "い", open).state;
    expect(reset(typed, "まったく別の本文").state.history.past).toHaveLength(0);
  });

  it("keepHistory なら残る", () => {
    const typed = insert(at("あ", 1), "い", open).state;
    const kept = reset(typed, "まったく別の本文", undefined, true);
    expect(kept.state.history.past).toHaveLength(1);
  });
});
