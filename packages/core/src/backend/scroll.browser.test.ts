import { afterEach, describe, expect, it } from "vitest";
import { readScroll, writeScroll } from "./scroll";

/**
 * 符号の規約はエンジンで割れていて、フェイクでは確かめられない。
 * 本物のスクロールコンテナを置いて測る。
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** スクロールできる量が端数を持つ、縦書きのスクロールコンテナ */
function scrollable(extent: number) {
  const el = document.createElement("div");
  Object.assign(el.style, {
    writingMode: "vertical-rl",
    width: "100px",
    height: "50px",
    overflowX: "auto",
    overflowY: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);
  const spacer = document.createElement("div");
  Object.assign(spacer.style, { width: `${extent}px`, height: "1px" });
  el.appendChild(spacer);
  document.body.appendChild(el);
  cleanups.push(() => el.remove());
  return el;
}

describe("縦書きのスクロール", () => {
  it("読み進んだ距離は向きに依らず 0 以上", () => {
    const el = scrollable(400);
    writeScroll(el, true, 60);
    expect(readScroll(el, true)).toBeCloseTo(60, 0);
  });

  it("スクロールしきった先で先頭へ戻らない", () => {
    // ブラウザがスクロールできる量は整数に丸められる。こちらの見積もりが端数ぶん多いと、
    // 「負で動かなかった = 正の規約」と誤読して先頭へ飛んでいた
    const el = scrollable(460.4);
    const max = el.scrollWidth - el.clientWidth;
    writeScroll(el, true, max + 0.4);
    expect(readScroll(el, true)).toBeCloseTo(max, 0);
  });

  it("端を超えて頼んでも端で止まる", () => {
    const el = scrollable(400);
    const max = el.scrollWidth - el.clientWidth;
    writeScroll(el, true, 99999);
    expect(readScroll(el, true)).toBeCloseTo(max, 0);
  });
});
