import type { Axis, Rect } from "../../src/backend/dom/axis";
import type { Content } from "../../src/backend/dom/geometry";
import { sentinelFor } from "../../src/backend/dom/geometry";

const LINE_HEIGHT = 30;
/** 全角 1 字ぶんの送り */
const EM = 20;
/** layer の左上 (クライアント座標)。surface と重ねる */
const ORIGIN = { x: 10, y: 20 };
/** 行送り方向の広さ。行数は足りていればいい */
const BREADTH = 300;

/**
 * 決まった字数で折り返すだけのレイアウト。
 *
 * 本物の組版はブラウザがやるので、node で縛りたいのは
 * 「落ちた矩形からキャレットをどう決めるか」だけ。行の切れ目と字の矩形さえ
 * 再現できれば足りる。
 *
 * layer は 1 行にちょうど perLine 字が収まる大きさにする。
 * そうしないと「行末へ」が本文の末尾まで飛ぶ。
 */
export function fakeContent(
  text: string,
  perLine: number,
  vertical = true,
): { axis: Axis; content: Content; lineCount: number } {
  const rendered = text + sentinelFor(text);
  const places = place(rendered, perLine);

  const length = perLine * EM;
  const layer: Rect = vertical
    ? { ...ORIGIN, width: BREADTH, height: length }
    : { ...ORIGIN, width: length, height: BREADTH };

  // ずれの扱いは axis.test.ts が見ているので、ここでは重ねておく
  const axis: Axis = { vertical, lineHeight: LINE_HEIGHT, fontBox: 16, layer, surface: layer };

  const content: Content = {
    rendered,
    charRect: (offset) => {
      const at = places[offset];
      return at ? rectOf(axis, at) : null;
    },
  };

  const lineCount = places.reduce((max, at) => Math.max(max, at.line + 1), 1);
  return { axis, content, lineCount };
}

interface Place {
  line: number;
  /** 行の中で何字目から始まるか */
  index: number;
  /** 送り方向に占める長さ。改行と末尾の番人は 0 */
  size: number;
}

/** 折り返しと改行で (行, 送り位置) を割り当てる */
function place(rendered: string, perLine: number): Place[] {
  const places: Place[] = [];
  let line = 0;
  let index = 0;
  for (const ch of rendered) {
    // 折り返しを起こした空白と改行は、次の行へ送らずに行末へぶら下げる。
    // pre-wrap が内容幅の外に置くのと同じ
    const hangs = ch === " " || ch === "\t" || ch === "\n";
    if (index >= perLine && !hangs) {
      line++;
      index = 0;
    }
    const size = ch === "\n" || ch === "​" ? 0 : EM;
    places.push({ line, index, size });
    if (ch === "\n") {
      line++;
      index = 0;
    } else if (++index > perLine) {
      // ぶら下がった空白が行を閉じた
      line++;
      index = 0;
    }
  }
  return places;
}

/** 字が置かれる矩形 (クライアント座標)。em の箱を行の真ん中に置く */
function rectOf(axis: Axis, at: Place): Rect {
  const { layer } = axis;
  const inline = at.index * EM;
  const near = at.line * LINE_HEIGHT + (LINE_HEIGHT - EM) / 2;
  if (axis.vertical) {
    // block は右端から左へ進む
    return {
      x: layer.x + layer.width - near - EM,
      y: layer.y + inline,
      width: EM,
      height: at.size,
    };
  }
  return { x: layer.x + inline, y: layer.y + near, width: at.size, height: EM };
}
