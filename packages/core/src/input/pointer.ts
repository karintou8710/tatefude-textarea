import type { Handle, Hits, Scroller } from "../layout";
import type { Caret } from "../text/caret";
import {
  cancelDrag,
  type GestureEffect,
  type GestureState,
  LONG_PRESS,
  newGestureState,
  onPointer,
  type PointerInput,
} from "./gesture";
import type { Pointer } from "./receivers";

/** ジェスチャが決まったときに呼ぶ先。選択の作り方は Textarea 側が持つ */
export interface PointerActions {
  disabled(): boolean;
  placeCaret(caret: Caret, extend: boolean): void;
  selectWord(offset: number): void;
  selectParagraph(offset: number): void;
  /** 選択の端にハンドルを出すか */
  showHandles(show: boolean): void;
  /** ハンドルを掴む。反対の端を anchor に置き直す */
  grabHandle(handle: Handle): void;
  focus(): void;
}

/**
 * 指とマウスの受け口。**DOM のイベントを判定 (gesture.ts) に流して、決まったことを実行する。**
 *
 * ここに置くのはブラウザの都合だけ——合成イベントの打ち消し、ポインタの捕捉、
 * 長押しのタイマ。何をタップしたことにするかは gesture.ts が決める。
 *
 * レイアウトからは「クリックした場所が何文字目か」(`Hits`) と
 * 「戻す先を忘れる」(`Scroller`) しか要らないので、その 2 つだけ受ける。
 */
export class PointerGestures implements Pointer {
  private state: GestureState = newGestureState;
  private longPress = 0;
  private disposers: (() => void)[] = [];

  constructor(
    private surface: HTMLElement,
    private hits: Hits,
    private scroller: Scroller,
    private actions: PointerActions,
  ) {
    this.bind();
  }

  /** focus を失ったらドラッグも終わり */
  cancelDrag(): void {
    this.state = cancelDrag(this.state);
  }

  destroy(): void {
    this.cancelLongPress();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }

  private bind(): void {
    const { surface } = this;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      surface.addEventListener(type, listener as EventListener, options);
      this.disposers.push(() =>
        surface.removeEventListener(type, listener as EventListener, options),
      );
    };

    // WebKit は pointerdown の preventDefault では合成マウスイベントを止めない。
    // touchend の後に届く mousedown が surface (div) に focus を移そうとして、
    // 入れたばかりの隠し入力から focus を奪う
    on("mousedown", (event) => event.preventDefault());

    // 合成マウスイベントは touchend の 300ms ほど後に届く。その間にキーボードで
    // レイアウトし直されていると、指の下の要素が変わってコンテナの外へ落ちる。外の mousedown は
    // focus を外すのが既定動作なので、開いたばかりのキーボードが閉じてしまう。
    // 出どころの touchend で止める。押した先はもう pointer 側で処理済み
    on("touchend", (event) => event.preventDefault(), { passive: false });

    // 指でドラッグしている間はパンさせない。touch-action は指を置いた時点で
    // 決まってしまうので、始まったあとに止めるにはこちらで断るしかない
    on("touchmove", (event) => this.state.drag && event.preventDefault(), { passive: false });

    on("pointerdown", (event) => {
      if (event.button !== 0 || this.actions.disabled()) return;
      event.preventDefault();
      const touch = event.pointerType === "touch";
      this.run({
        type: "down",
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        at: event.timeStamp,
        touch,
        shift: event.shiftKey,
        clicks: event.detail,
        // ハンドルは指のときだけ出す
        handle: touch ? this.hits.hitHandle(event.clientX, event.clientY) : null,
      });
    });

    on("pointermove", (event) =>
      this.run({ type: "move", id: event.pointerId, x: event.clientX, y: event.clientY }),
    );

    on("pointerup", (event) =>
      this.run({
        type: "up",
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        shift: event.shiftKey,
      }),
    );

    // ブラウザがパンを取った
    on("pointercancel", (event) => this.run({ type: "cancel", id: event.pointerId }));
  }

  private run(input: PointerInput): void {
    const result = onPointer(this.state, input);
    this.state = result.state;
    for (const effect of result.effects) this.perform(effect);
  }

  private perform(effect: GestureEffect): void {
    switch (effect.type) {
      case "forgetAnchor":
        this.scroller.forgetAnchor();
        break;
      case "placeCaret":
        this.actions.placeCaret(this.hits.hitTest(effect.x, effect.y), effect.extend);
        break;
      case "selectWord":
        this.actions.selectWord(this.hits.hitTest(effect.x, effect.y).offset);
        break;
      case "selectParagraph":
        this.actions.selectParagraph(this.hits.hitTest(effect.x, effect.y).offset);
        break;
      case "grabHandle":
        this.actions.grabHandle(effect.handle);
        break;
      case "showHandles":
        this.actions.showHandles(effect.show);
        break;
      case "focus":
        this.actions.focus();
        break;
      case "capture":
        this.surface.setPointerCapture(effect.id);
        break;
      case "release":
        if (this.surface.hasPointerCapture(effect.id)) {
          this.surface.releasePointerCapture(effect.id);
        }
        break;
      case "waitLongPress":
        this.waitLongPress(effect.id, effect.x, effect.y);
        break;
      case "cancelLongPress":
        this.cancelLongPress();
        break;
    }
  }

  private waitLongPress(id: number, x: number, y: number): void {
    const view = this.surface.ownerDocument.defaultView;
    if (!view) return;
    this.longPress = view.setTimeout(() => {
      this.longPress = 0;
      this.run({ type: "longPress", id, x, y });
    }, LONG_PRESS);
  }

  private cancelLongPress(): void {
    if (!this.longPress) return;
    this.surface.ownerDocument.defaultView?.clearTimeout(this.longPress);
    this.longPress = 0;
  }
}
