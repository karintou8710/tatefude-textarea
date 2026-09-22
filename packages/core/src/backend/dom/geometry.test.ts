import { describe, expect, it } from "vitest";
import { fakeContent } from "../../../test/fakes/content";
import type { ViewState } from "../backend";
import type { Rect } from "./axis";
import * as geometry from "./geometry";

/** 5 字で折り返す 2 行。0 行目が 0〜4、1 行目が 5〜9 */
const TWO_LINES = "あいうえおかきくけこ";

describe("caretRect", () => {
  it("行送りぶんだけ隣の行へ動く。縦書きは左へ", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    const first = geometry.caretRect(axis, content, { offset: 0, preferEnd: false });
    const second = geometry.caretRect(axis, content, { offset: 5, preferEnd: false });
    expect(first.x - second.x).toBe(axis.lineHeight);
    // どちらも行の頭なので、インライン方向は動かない
    expect(first.y).toBe(second.y);
  });

  it("縦書きは横棒、横書きは縦棒。厚みは持たず、長さは字の箱ぶん", () => {
    for (const vertical of [true, false]) {
      const { axis, content } = fakeContent(TWO_LINES, 5, vertical);
      const rect = geometry.caretRect(axis, content, { offset: 1, preferEnd: false });
      expect(vertical ? rect.height : rect.width).toBe(0);
      expect(vertical ? rect.width : rect.height).toBe(axis.fontBox);
    }
  });

  describe("折り返しの境目", () => {
    it("preferEnd なら前の行の末尾、でなければ次の行の頭に着く", () => {
      const { axis, content } = fakeContent(TWO_LINES, 5);
      const atEnd = geometry.caretRect(axis, content, { offset: 5, preferEnd: true });
      const atStart = geometry.caretRect(axis, content, { offset: 5, preferEnd: false });
      // 前の行 = まだ右側。次の行は行送りぶん左
      expect(atEnd.x - atStart.x).toBe(axis.lineHeight);
      // 前の行の末尾は行の終わり、次の行の頭は行の始まり
      expect(atEnd.y).toBeGreaterThan(atStart.y);
      expect(atStart.y).toBe(0);
    });

    it("改行の直後は preferEnd でも次の行の頭。前の行に着ける余地がない", () => {
      const { axis, content } = fakeContent("あい\nうえ", 5);
      const atEnd = geometry.caretRect(axis, content, { offset: 3, preferEnd: true });
      const atStart = geometry.caretRect(axis, content, { offset: 3, preferEnd: false });
      expect(atEnd).toEqual(atStart);
      expect(atEnd.y).toBe(0);
    });
  });
});

describe("caretInLine", () => {
  it("指定の行の、指定のインライン位置にいちばん近い字に着く", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    // 1 行目の 0〜20px は 5 文字目 (行頭)
    expect(geometry.caretInLine(axis, content, 1, 0).offset).toBe(5);
    expect(geometry.caretInLine(axis, content, 1, 20).offset).toBe(6);
  });

  it("字の後ろ半分を指したら次の位置へ。ちょうど中点は手前", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    // 6 文字目は 20〜40px。中点は 30
    expect(geometry.caretInLine(axis, content, 1, 29).offset).toBe(6);
    expect(geometry.caretInLine(axis, content, 1, 30).offset).toBe(6);
    expect(geometry.caretInLine(axis, content, 1, 31).offset).toBe(7);
  });

  it("隠れている行にも移れる。クリックした場所ではなく行番号で引くから", () => {
    const text = "あいうえお".repeat(20);
    const { axis, content, lineCount } = fakeContent(text, 5);
    expect(lineCount).toBe(20);
    expect(geometry.caretInLine(axis, content, 19, 0).offset).toBe(95);
  });

  it("改行はその行の持ち物。次の行まで行き過ぎない", () => {
    const { axis, content } = fakeContent("あい\nうえお", 5);
    // 0 行目の行末を指しても、改行を跨いで 1 行目へは行かない
    expect(geometry.caretInLine(axis, content, 0, 100).offset).toBe(2);
  });
});

describe("moveAcross", () => {
  it("行を移ってもスクロール位置を保つ", () => {
    const { axis, content, lineCount } = fakeContent(TWO_LINES, 5);
    const moved = geometry.moveAcross(
      axis,
      content,
      { offset: 2, preferEnd: false },
      1,
      null,
      lineCount,
    );
    expect(moved.caret.offset).toBe(7);
    expect(moved.goal).not.toBeNull();
  });

  it("goal を持ち回れば、短い行を通っても元の位置に戻る", () => {
    const { axis, content, lineCount } = fakeContent("あいうえお\nか\nきくけこさ", 5);
    const down = (caret: { offset: number; preferEnd: boolean }, goal: number | null) =>
      geometry.moveAcross(axis, content, caret, 1, goal, lineCount);

    // 0 行目の 4 文字目 → 1 文字しかない行 → 2 行目
    const first = down({ offset: 3, preferEnd: false }, null);
    expect(first.caret.offset).toBe(7);
    const second = down(first.caret, first.goal);
    expect(second.caret.offset).toBe(11);
  });

  it("端では止まる。手前は先頭、奥は末尾", () => {
    const { axis, content, lineCount } = fakeContent(TWO_LINES, 5);
    const up = geometry.moveAcross(
      axis,
      content,
      { offset: 2, preferEnd: false },
      -1,
      null,
      lineCount,
    );
    expect(up.caret).toEqual({ offset: 0, preferEnd: false });

    const down = geometry.moveAcross(
      axis,
      content,
      { offset: 7, preferEnd: false },
      1,
      null,
      lineCount,
    );
    expect(down.caret).toEqual({ offset: 10, preferEnd: true });
  });
});

describe("lineEdge", () => {
  it("行頭は preferEnd を降ろす。折り返しの境目で前の行へ戻らないため", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    expect(geometry.lineEdge(axis, content, { offset: 7, preferEnd: false }, "start")).toEqual({
      offset: 5,
      preferEnd: false,
    });
  });

  it("行末は折り返しの位置。preferEnd を立てて前の行に留める", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    expect(geometry.lineEdge(axis, content, { offset: 2, preferEnd: false }, "end")).toEqual({
      offset: 5,
      preferEnd: true,
    });
  });

  it("折り返しを起こした空白は行末にぶら下がる。行末はその後ろ", () => {
    // 5 字で折り返すので、6 字目の空白が 0 行目の外にぶら下がる
    const { axis, content } = fakeContent("あいうえお かきくけこ", 5);
    expect(geometry.lineEdge(axis, content, { offset: 2, preferEnd: false }, "end")).toEqual({
      offset: 6,
      preferEnd: true,
    });
  });
});

describe("caretAtPoint", () => {
  it("折り返しの境目は、クリックした行の側に着ける", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    const onFirst = geometry.caretRect(axis, content, { offset: 5, preferEnd: true });
    const onSecond = geometry.caretRect(axis, content, { offset: 5, preferEnd: false });
    // 縦書きなので、クリックした x がどちらの行に近いかで決まる
    const at = (x: number) => geometry.caretAtPoint(axis, content, 5, x, 0).preferEnd;
    expect(at(axis.surface.x + onFirst.x)).toBe(true);
    expect(at(axis.surface.x + onSecond.x)).toBe(false);
  });

  it("どちらの行に着けても同じ場所なら preferEnd を立てる", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    // 行の途中はどちらでも同じ字の上に立つ
    expect(geometry.caretAtPoint(axis, content, 2, 0, 0)).toEqual({ offset: 2, preferEnd: true });
  });
});

describe("handlePoints", () => {
  const view = (over: Partial<ViewState> = {}): ViewState => ({
    text: TWO_LINES,
    selection: { start: 2, end: 7 },
    caret: { offset: 7, preferEnd: false },
    caretVisible: false,
    focused: true,
    handles: true,
    composition: null,
    placeholder: null,
    ...over,
  });

  it("選択の両端に 1 つずつ。キャレットの棒から外側へ押し出す", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    const points = geometry.handlePoints(axis, content, view());
    expect(points.map(([edge]) => edge)).toEqual(["start", "end"]);
    // 縦書きなら始点が右 (行の始まる側)、終点が左
    expect(points[0][1].x).toBeGreaterThan(points[1][1].x);
  });

  it("出さないと決まっているとき、focus が無いとき、選択が潰れているときは空", () => {
    const { axis, content } = fakeContent(TWO_LINES, 5);
    expect(geometry.handlePoints(axis, content, view({ handles: false }))).toEqual([]);
    expect(geometry.handlePoints(axis, content, view({ focused: false }))).toEqual([]);
    expect(geometry.handlePoints(axis, content, view({ selection: { start: 3, end: 3 } }))).toEqual(
      [],
    );
  });
});

describe("pitchOf", () => {
  const at = (center: number): Rect => ({ x: center - 10, y: 0, width: 20, height: 20 });

  it("いちばん狭い隙間が行送り。空行があっても引っ張られない", () => {
    // 100 と 70 は隣り合う行、10 は空行を挟んだ先
    expect(geometry.pitchOf(true, [at(100), at(70), at(10)], 99)).toBe(30);
  });

  it("同じ行に出た断片は数えない。1px 以内は同じ行とみなす", () => {
    expect(geometry.pitchOf(true, [at(100), at(100.2), at(70)], 99)).toBe(30);
  });

  it("端数を落とさない。丸めると行が進むほど列がずれる", () => {
    // 16px × 1.8 = 28.8。1/4px に丸めると 28.75 になり、1 行あたり 0.05px の誤差が出る
    const centers = [0, 1, 2, 3, 4, 5].map((i) => at(300 - i * 28.8));
    expect(geometry.pitchOf(true, centers, 99)).toBeCloseTo(28.8, 6);
  });

  it("1 本ぶんの測り誤差は端から端までで均す", () => {
    // 途中が 0.1px ずれていても、全体を行数で割り直すので寄らない
    const centers = [at(300), at(271.2), at(242.3), at(213.6), at(184.8)];
    expect(geometry.pitchOf(true, centers, 99)).toBeCloseTo(28.8, 2);
  });

  it("行が 1 本しか見つからなければ代用の値を返す", () => {
    expect(geometry.pitchOf(true, [at(100)], 99)).toBe(99);
    expect(geometry.pitchOf(true, [], 99)).toBe(99);
  });
});

describe("末尾の番人", () => {
  it("空のときと改行で終わるときだけ立てる。行ボックスが無いとキャレットを置けない", () => {
    expect(geometry.sentinelFor("")).not.toBe("");
    expect(geometry.sentinelFor("あ\n")).not.toBe("");
    expect(geometry.sentinelFor("あ")).toBe("");
  });

  it("本文の長さには数えない", () => {
    const { content } = fakeContent("あい\n", 5);
    expect(content.rendered.length).toBe(4);
    expect(geometry.textLength(content)).toBe(3);
  });
});
