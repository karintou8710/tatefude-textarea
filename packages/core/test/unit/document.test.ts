import { describe, expect, it } from "vitest";
import { TextDocument } from "../../src/model/document";

const NO_LIMIT = Number.POSITIVE_INFINITY;

function doc(text = "", selection?: { anchor: number; focus: number }) {
  const d = new TextDocument(text);
  if (selection) d.setSelection(selection.anchor, selection.focus);
  return d;
}

describe("本文と選択", () => {
  it("改行は \\n に揃う", () => {
    expect(new TextDocument("あ\r\nい\rう").text).toBe("あ\nい\nう");
  });

  it("選択は掴んだ側と動く側で持ち、range は前後に揃える", () => {
    const d = doc("吾輩は猫である");
    d.setSelection(5, 2);
    expect(d.selection).toEqual({ anchor: 5, focus: 2 });
    expect(d.range()).toEqual([2, 5]);
    expect(d.selectedText).toBe("は猫で");
  });

  it("本文の外は端に丸める", () => {
    const d = doc("あいう");
    d.setSelection(-5, 99);
    expect(d.selection).toEqual({ anchor: 0, focus: 3 });
  });

  it("extend でないと掴んだ側も動く", () => {
    const d = doc("あいうえお", { anchor: 1, focus: 1 });
    d.moveCaret({ offset: 3, preferEnd: false }, true);
    expect(d.selection).toEqual({ anchor: 1, focus: 3 });
    d.moveCaret({ offset: 4, preferEnd: false }, false);
    expect(d.selection).toEqual({ anchor: 4, focus: 4 });
  });
});

describe("replace", () => {
  it("差し替えたあとはキャレットが入れた字の後ろに来る", () => {
    const d = doc("あいう");
    expect(d.replace(1, 2, "XY", "input", NO_LIMIT)).toBe(true);
    expect(d.text).toBe("あXYう");
    expect(d.selection).toEqual({ anchor: 3, focus: 3 });
  });

  it("何も起きない差し替えは false。描き直しを省くため", () => {
    const d = doc("あいう");
    expect(d.replace(1, 1, "", "input", NO_LIMIT)).toBe(false);
    expect(d.text).toBe("あいう");
  });

  it("maxLength を超えるぶんは切る", () => {
    const d = doc("あい");
    // 上限 4、本文 2 文字なので、入るのは 2 文字だけ
    d.replace(2, 2, "うえお", "input", 4);
    expect(d.text).toBe("あいうえ");
  });

  it("選択を潰して入れるときは、消えるぶんが空きに戻る", () => {
    const d = doc("あいうえお");
    // 5 文字中 3 文字を消して入れるので、上限 5 でも 3 文字入る
    d.replace(1, 4, "XYZ", "input", 5);
    expect(d.text).toBe("あXYZお");
  });
});

describe("deleteBy", () => {
  it("選択があれば、向きに関わらずそれを消す", () => {
    for (const direction of [1, -1] as const) {
      const d = doc("あいうえお", { anchor: 1, focus: 4 });
      expect(d.deleteBy(direction, false, NO_LIMIT)).toBe(true);
      expect(d.text).toBe("あお");
    }
  });

  it("選択が無ければ書記素 1 つぶん。結合文字はまとめて消える", () => {
    const d = doc("がき", { anchor: 2, focus: 2 });
    expect(d.deleteBy(-1, false, NO_LIMIT)).toBe(true);
    expect(d.text).toBe("き");
  });

  it("端では何も起きず false", () => {
    const head = doc("あい", { anchor: 0, focus: 0 });
    expect(head.deleteBy(-1, false, NO_LIMIT)).toBe(false);
    const tail = doc("あい", { anchor: 2, focus: 2 });
    expect(tail.deleteBy(1, false, NO_LIMIT)).toBe(false);
  });
});

describe("履歴", () => {
  it("戻すと本文も選択も戻る", () => {
    const d = doc("あいう", { anchor: 3, focus: 3 });
    d.replace(3, 3, "えお", "input", NO_LIMIT);
    expect(d.text).toBe("あいうえお");

    expect(d.undo()).toBe(true);
    expect(d.text).toBe("あいう");
    expect(d.selection).toEqual({ anchor: 3, focus: 3 });

    expect(d.redo()).toBe(true);
    expect(d.text).toBe("あいうえお");
  });

  it("戻せるものが無ければ false", () => {
    const d = doc("あ");
    expect(d.undo()).toBe(false);
    expect(d.redo()).toBe(false);
    expect(d.canUndo).toBe(false);
  });

  it("続けて打った字はひとまとめに戻る", () => {
    const d = doc("", { anchor: 0, focus: 0 });
    d.replace(0, 0, "あ", "input", NO_LIMIT);
    d.replace(1, 1, "い", "input", NO_LIMIT);
    d.undo();
    expect(d.text).toBe("");
  });

  it("区切ると別々に戻る", () => {
    const d = doc("", { anchor: 0, focus: 0 });
    d.replace(0, 0, "あ", "input", NO_LIMIT);
    d.breakCoalescing();
    d.replace(1, 1, "い", "input", NO_LIMIT);
    d.undo();
    expect(d.text).toBe("あ");
  });

  it("打つのと消すのはまとまらない", () => {
    const d = doc("", { anchor: 0, focus: 0 });
    d.replace(0, 0, "あい", "input", NO_LIMIT);
    d.deleteBy(-1, false, NO_LIMIT);
    expect(d.text).toBe("あ");
    d.undo();
    expect(d.text).toBe("あい");
  });
});

describe("reset", () => {
  it("同じ本文で選択も指定しなければ false", () => {
    const d = doc("あいう");
    expect(d.reset("あいう")).toBe(false);
  });

  it("同じ本文でも、選択を指定すれば動いたことにする", () => {
    const d = doc("あいう");
    expect(d.reset("あいう", { anchor: 1, focus: 2 })).toBe(true);
    expect(d.selection).toEqual({ anchor: 1, focus: 2 });
  });

  it("既定では履歴を捨てる", () => {
    const d = doc("あ", { anchor: 1, focus: 1 });
    d.replace(1, 1, "い", "input", NO_LIMIT);
    expect(d.canUndo).toBe(true);
    d.reset("まったく別の本文");
    expect(d.canUndo).toBe(false);
  });

  it("keepHistory なら残る", () => {
    const d = doc("あ", { anchor: 1, focus: 1 });
    d.replace(1, 1, "い", "input", NO_LIMIT);
    d.reset("まったく別の本文", undefined, true);
    expect(d.canUndo).toBe(true);
  });
});
