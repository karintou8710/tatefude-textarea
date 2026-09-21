import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaretBlink } from "./blink";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  let repaints = 0;
  const blink = new CaretBlink(() => repaints++);
  return { blink, paints: () => repaints };
}

describe("点滅", () => {
  it("間隔ごとに表と裏が入れ替わり、そのたびに描き直しを頼む", () => {
    const { blink, paints } = setup();
    blink.sync(true, 100);
    expect(blink.on).toBe(true);

    vi.advanceTimersByTime(100);
    expect(blink.on).toBe(false);
    expect(paints()).toBe(1);

    vi.advanceTimersByTime(100);
    expect(blink.on).toBe(true);
    expect(paints()).toBe(2);
  });

  it("focus していなければ点滅しない", () => {
    const { blink, paints } = setup();
    blink.sync(false, 100);
    vi.advanceTimersByTime(500);
    expect(blink.on).toBe(true);
    expect(paints()).toBe(0);
  });

  it("間隔が 0 以下なら点滅しない", () => {
    const { blink, paints } = setup();
    blink.sync(true, 0);
    vi.advanceTimersByTime(500);
    expect(paints()).toBe(0);
  });
});

describe("数え直す", () => {
  it("消える番でも、呼び直せば出た状態から始まる", () => {
    const { blink } = setup();
    blink.sync(true, 100);
    vi.advanceTimersByTime(100);
    expect(blink.on).toBe(false);

    // 打った / 動かした
    blink.sync(true, 100);
    expect(blink.on).toBe(true);

    // 数え直しているので、前の残りでは消えない
    vi.advanceTimersByTime(99);
    expect(blink.on).toBe(true);
    vi.advanceTimersByTime(1);
    expect(blink.on).toBe(false);
  });

  it("focus を失ったら止まって、出た状態に戻る", () => {
    const { blink, paints } = setup();
    blink.sync(true, 100);
    vi.advanceTimersByTime(100);
    expect(blink.on).toBe(false);

    blink.sync(false, 100);
    expect(blink.on).toBe(true);
    vi.advanceTimersByTime(500);
    expect(paints()).toBe(1);
  });

  it("止めたら二度と刻まない", () => {
    const { blink, paints } = setup();
    blink.sync(true, 100);
    blink.stop();
    vi.advanceTimersByTime(500);
    expect(paints()).toBe(0);
    expect(blink.on).toBe(true);
  });
});
