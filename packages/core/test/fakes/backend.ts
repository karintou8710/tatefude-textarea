import type { Backend, ViewState } from "../../src/backend/backend";
import type { Caret } from "../../src/text/caret";
import { fakeLayout } from "./layout";

/**
 * 偽のバックエンド。**呼ばれた順を覚えるだけ**で、何も描かない。
 * 組み立て (textarea.ts) が誰をどの順で叩くかを見るために使う。
 *
 * 隠し入力と指は本物が動くので、偽物は作らない。
 * そのぶんブラウザが要るので、使うのは `test/browser/textarea.test.ts`。
 */
export interface FakeBackend {
  backend: Backend;
  calls: string[];
  /** 最後に渡された表示状態 */
  shown(): ViewState | null;
}

export function fakeBackend(text: string, perLine = 8): FakeBackend {
  const calls: string[] = [];
  const layout = fakeLayout(text, perLine);
  let last: ViewState | null = null;

  const backend: Backend = {
    // 指が配線するので、本物の要素が要る
    surface: document.createElement("div"),
    lineCount: Math.max(1, Math.ceil(text.length / perLine)),
    fontSize: 16,
    linesPerPage: () => layout.linesPerPage(),
    // 幾何は答えない。組み立てを見るのに要らないので、呼ばれたら落とす
    hitTest: () => {
      throw new Error("fakeBackend: hitTest は答えられない");
    },
    hitHandle: () => null,
    caretRect: () => ({ x: 0, y: 0, width: 16, height: 0 }),
    selectionRect: () => null,
    moveAcross: (caret, direction, goal) => layout.moveAcross(caret, direction, goal),
    lineEdge: (caret: Caret, edge) => layout.lineEdge(caret, edge),
    scrollOffset: 0,
    forgetAnchor: () => calls.push("forgetAnchor"),
    setOptions: () => calls.push("setOptions"),
    refresh: () => calls.push("refresh"),
    update: (state) => {
      last = state;
      calls.push("update");
    },
    show: (state) => {
      last = state;
      calls.push("show");
    },
    destroy: () => calls.push("backend.destroy"),
  };

  return { backend, calls, shown: () => last };
}
