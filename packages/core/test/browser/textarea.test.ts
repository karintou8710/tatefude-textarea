import { afterEach, describe, expect, it, vi } from "vitest";
import { DomTextarea } from "../../src/dom";
import { Textarea } from "../../src/textarea";
import type { TextareaOptions } from "../../src/types";
import { fakeBackend } from "../fake-backend";
import { applyStyle } from "./style";

/**
 * 組み立て (textarea.ts) が誰をどの順で叩くかを見る。
 *
 * バックエンドだけ偽物にして、隠し入力と指は本物を動かす。
 * **差し替えられるのは backend だけ**なので、ここはブラウザで回す。
 */

const STYLE = { size: 20, lineHeight: 1.8, padding: 10 };
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function container(): HTMLElement {
  const el = document.createElement("div");
  Object.assign(el.style, { width: "300px", height: "200px" });
  applyStyle(el, STYLE);
  document.body.appendChild(el);
  cleanups.push(() => el.remove());
  return el;
}

function setup(options: TextareaOptions = {}) {
  const el = container();
  const value = options.value ?? "あいうえお";
  // 偽レイアウトは本文から行を割るので、同じものを渡す
  const fake = fakeBackend(value);
  const textarea = new Textarea(el, { backend: fake.backend, value, ...options });
  cleanups.push(() => textarea.destroy());
  fake.calls.length = 0;
  return { container: el, textarea, fake, hidden: hiddenOf(el) };
}

function hiddenOf(el: HTMLElement): HTMLTextAreaElement {
  const hidden = el.querySelector("textarea");
  if (!hidden) throw new Error("隠し入力が無い");
  return hidden;
}

describe("動いたあとの後始末", () => {
  it("本文が動いたら onChange と onSelectionChange の順で知らせる", () => {
    const seen: string[] = [];
    const { textarea } = setup({
      onChange: () => seen.push("change"),
      onSelectionChange: () => seen.push("selection"),
    });
    textarea.commands.insertText("か");
    expect(seen).toEqual(["change", "selection"]);
  });

  it("選択だけなら onChange は呼ばない", () => {
    const onChange = vi.fn();
    const onSelectionChange = vi.fn();
    const { textarea } = setup({ onChange, onSelectionChange });
    textarea.commands.setSelection(1, 3);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith({ anchor: 1, head: 3 });
  });

  it("何も動かなければ描き直さない。点滅を飛ばさないため", () => {
    const { textarea, fake } = setup();
    textarea.commands.setValue("あいうえお");
    expect(fake.calls).toEqual([]);
  });

  it("setValue は既定では onChange を呼ばない", () => {
    const onChange = vi.fn();
    const { textarea } = setup({ onChange });
    textarea.commands.setValue("さしすせそ");
    expect(onChange).not.toHaveBeenCalled();
    expect(textarea.state.value).toBe("さしすせそ");

    textarea.commands.setValue("たちつてと", { notify: true });
    expect(onChange).toHaveBeenCalledWith("たちつてと");
  });
});

describe("表示に渡すもの", () => {
  it("選択が伸びている間はキャレットを出さない", () => {
    const { textarea, fake } = setup();
    textarea.commands.setSelection(1, 3);
    expect(fake.shown()?.caretVisible).toBe(false);

    textarea.commands.setSelection(3);
    expect(fake.shown()?.caretVisible).toBe(true);
  });

  it("focus していなければ、そう伝える", () => {
    const { textarea, fake } = setup();
    textarea.commands.setSelection(1);
    expect(fake.shown()?.focused).toBe(false);
  });

  it("本文が空のときだけ placeholder を渡す", () => {
    const { textarea, fake } = setup({ value: "", placeholder: "書く" });
    textarea.commands.setSelection(0);
    expect(fake.shown()?.placeholder).toBe("書く");

    textarea.commands.insertText("あ");
    expect(fake.shown()?.placeholder).toBe(null);
  });
});

describe("叩いたら動くか (can)", () => {
  it("履歴が空なら戻せない。打てば戻せる", () => {
    const { textarea } = setup();
    expect(textarea.can.undo()).toBe(false);
    expect(textarea.can.redo()).toBe(false);

    textarea.commands.insertText("か");
    expect(textarea.can.undo()).toBe(true);
    expect(textarea.can.redo()).toBe(false);

    textarea.commands.undo();
    expect(textarea.can.redo()).toBe(true);
  });

  it("聞くだけでは何も動かない。描き直しも通知も起きない", () => {
    const onChange = vi.fn();
    const { textarea, fake } = setup({ onChange });
    textarea.commands.insertText("か");
    fake.calls.length = 0;
    onChange.mockClear();

    expect(textarea.can.undo()).toBe(true);
    expect(textarea.can.cut()).toBe(false);
    expect(textarea.can.insertText("き")).toBe(true);

    expect(fake.calls).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    // 初期のキャレットは文頭なので、打った 1 字が頭に入ったまま
    expect(textarea.state.value).toBe("かあいうえお");
  });

  it("選択が無ければ切り取れない", () => {
    const { textarea } = setup();
    expect(textarea.can.cut()).toBe(false);
    textarea.commands.setSelection(1, 3);
    expect(textarea.can.cut()).toBe(true);
  });

  it("readOnly なら打てない", () => {
    const { textarea } = setup();
    expect(textarea.can.insertText("か")).toBe(true);
    textarea.setOptions({ readOnly: true });
    expect(textarea.can.insertText("か")).toBe(false);
  });

  it("「許されているか」ではなく「動くか」を返す", () => {
    const { textarea } = setup();
    // いまと同じ本文を入れても動かない
    expect(textarea.can.setValue("あいうえお")).toBe(false);
    expect(textarea.can.setValue("さしすせそ")).toBe(true);
  });

  it("選択の置き直しは、同じ場所でも動く。打鍵のまとまりを切るから", () => {
    const { textarea } = setup();
    textarea.commands.setSelection(2);
    expect(textarea.can.setSelection(2)).toBe(true);
  });
});

describe("キャレットを追う", () => {
  /**
   * 隠し入力を置き直すのがレイアウトより先だと、`caretRect` が動く前の DOM を
   * 測ってしまう。順番そのものは覗けないので、**着いた場所**で縛る。
   * ここだけは本物のバックエンドが要る (偽物は矩形を動かさない)
   */
  it("描き直してから、隠し入力をキャレットの脇へ置く", () => {
    const el = container();
    const textarea = new DomTextarea(el, { value: "あいうえお", caretBlinkInterval: 0 });
    cleanups.push(() => textarea.destroy());
    const hidden = hiddenOf(el);

    textarea.commands.setSelection(0);
    const before = hidden.style.top;
    textarea.commands.insertText("かきくけこ");

    expect(hidden.style.top).not.toBe(before);
    // 縦書きなので、字送り方向 (top) がいまのキャレットに乗っている
    expect(Number.parseFloat(hidden.style.top)).toBe(Math.round(textarea.caretRect.y));
  });
});

describe("設定と後片付け", () => {
  it("setOptions は部品に配ってから描き直す", () => {
    const { textarea, fake, hidden } = setup();
    textarea.setOptions({ readOnly: true });
    expect(fake.calls).toEqual(["setOptions", "show"]);
    expect(hidden.readOnly).toBe(true);
  });

  it("setOptions は渡されていないコールバックを消さない", () => {
    const onChange = vi.fn();
    const { textarea } = setup({ onChange });

    // 別の設定だけ渡す
    textarea.setOptions({ placeholder: "書く" });
    textarea.commands.insertText("か");
    expect(onChange).toHaveBeenCalledTimes(1);

    // 明示的に undefined を渡したときだけ外れる
    textarea.setOptions({ onChange: undefined });
    textarea.commands.insertText("き");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("readOnly なら打っても動かない", () => {
    const { textarea } = setup();
    textarea.setOptions({ readOnly: true });
    textarea.commands.insertText("か");
    expect(textarea.state.value).toBe("あいうえお");
  });

  it("destroy は部品を全部畳む。2 回呼んでも 1 回だけ", () => {
    const { container: el, textarea, fake } = setup();
    textarea.destroy();
    textarea.destroy();
    expect(fake.calls).toEqual(["backend.destroy"]);
    // 隠し入力も畳まれて、コンテナから消えている
    expect(el.querySelector("textarea")).toBeNull();
  });

  it("畳んだあとは描き直さない", () => {
    const { textarea, fake } = setup();
    textarea.destroy();
    fake.calls.length = 0;
    textarea.commands.insertText("か");
    expect(fake.calls).toEqual([]);
  });
});
