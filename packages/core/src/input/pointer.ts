import type { Handle, Layout, Scroller } from "../backend/backend";
import type { Caret } from "../model/movement";

/** これだけ動いたら、叩いたのではなくスクロール (CSS px) */
const TAP_SLOP = 8;

/** 置いたままこれだけ待たれたら長押し。iOS の作法に合わせる (ms) */
const LONG_PRESS = 500;

/** 続けて叩いたと見なす間隔 (ms) と、その間に許す指のずれ (CSS px) */
const DOUBLE_TAP = 300;
const DOUBLE_TAP_SLOP = 24;

/** ジェスチャが決まったときに呼ぶ先。選択の作り方は Textarea 側が持つ */
export interface PointerActions {
  disabled(): boolean;
  placeCaret(caret: Caret, extend: boolean): void;
  selectWord(offset: number): void;
  selectParagraph(offset: number): void;
  /** 選択の端につまみを出すか */
  showHandles(show: boolean): void;
  /** つまみを掴む。反対の端を anchor に置き直す */
  grabHandle(handle: Handle): void;
  focus(): void;
}

/**
 * 指とマウスの受け口。
 *
 * 組みからは「突いた場所が何文字目か」(Layout) と
 * 「戻す先を忘れる」(Scroller) しか要らないので、その 2 つだけ受ける。
 */
export class PointerGestures {
  /** 引きずっている最中。extend なら伸ばす、でなければキャレットを動かす */
  private drag: { extend: boolean } | null = null;
  /** 指を置いた場所。離すまでは、叩いたのかスクロールなのか決まらない */
  private tap: { id: number; x: number; y: number } | null = null;
  private longPress = 0;
  /** 直前に叩いた場所と時刻、続けて叩かれた回数 */
  private lastTap: { at: number; x: number; y: number } | null = null;
  private taps = 0;
  private disposers: (() => void)[] = [];

  constructor(
    private surface: HTMLElement,
    private layout: Layout,
    private scroller: Scroller,
    private actions: PointerActions,
  ) {
    this.bind();
  }

  /** 焦点を失ったらドラッグも終わり */
  cancelDrag(): void {
    this.drag = null;
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
    // touchend の後に届く mousedown が surface (div) にフォーカスを移そうとして、
    // 入れたばかりの hidden input から焦点を奪う
    on("mousedown", (event) => event.preventDefault());

    // 合成マウスイベントは touchend の 300ms ほど後に届く。その間にキーボードで
    // 組み直っていると、指の下の要素が変わって器の外へ落ちる。外の mousedown は
    // 焦点を外すのが既定動作なので、開いたばかりのキーボードが閉じてしまう。
    // 出どころの touchend で止める。押した先はもう pointer 側で処理済み
    on("touchend", (event) => event.preventDefault(), { passive: false });

    // 指で引きずっている間はパンさせない。touch-action は指を置いた時点で
    // 決まってしまうので、始まったあとに止めるにはこちらで断るしかない
    on("touchmove", (event) => this.drag && event.preventDefault(), { passive: false });

    on("pointerdown", (event) => this.down(event));
    on("pointermove", (event) => this.move(event));
    on("pointerup", (event) => this.up(event));
    on("pointercancel", (event) => {
      // ブラウザがパンを取った
      this.forgetTap();
      this.stop(event);
    });
  }

  private down(event: PointerEvent): void {
    if (event.button !== 0 || this.actions.disabled()) return;
    event.preventDefault();
    // 触り直した。指でパンするならもう戻す先ではないし、叩くなら下で置き直す
    this.scroller.forgetAnchor();

    if (event.pointerType === "touch") {
      this.touchDown(event);
      return;
    }
    // マウスで触り直したら、指のためのつまみは引っ込める
    this.actions.showHandles(false);

    // 測る → 置く → 焦点、の順。焦点を先に入れると、その時点の
    // 古いキャレットを見せるために送りが動き、突いた場所が画面ごとずれる
    const hit = this.layout.hitTest(event.clientX, event.clientY);
    if (event.detail >= 3) {
      this.actions.selectParagraph(hit.offset);
    } else if (event.detail === 2) {
      this.actions.selectWord(hit.offset);
    } else {
      this.begin(event, true);
      this.actions.placeCaret(hit, event.shiftKey);
    }
    this.actions.focus();
  }

  /**
   * 指の割り当ては iOS の編集可能なテキストに合わせる。
   *
   * - 叩く … キャレットを置く
   * - 続けて 2 回 … 単語、3 回 … 段落。掴んだまま引きずれば伸びる
   * - 長押し … そのままキャレットを引き回す
   * - なぞる … スクロール (ブラウザに任せる)
   */
  private touchDown(event: PointerEvent): void {
    // つまみは押した時点で掴む。掴みに来た指を叩いた扱いにしても意味がない。
    // つまみが出るのは選択があるときだけなので、叩く・なぞるとは競合しない
    const handle = this.layout.hitHandle(event.clientX, event.clientY);
    if (handle) {
      this.grab(event, handle);
      return;
    }

    const previous = this.lastTap;
    this.taps = previous && this.isNearInTime(event, previous) ? this.taps + 1 : 1;
    this.lastTap = { at: event.timeStamp, x: event.clientX, y: event.clientY };

    if (this.taps >= 2) {
      // 合成マウスイベントは止めてあるので、ダブルクリックの detail は当てにできない。
      // 2 回目を押した時点で選び、そのまま引きずれるようにする
      const hit = this.layout.hitTest(event.clientX, event.clientY);
      if (this.taps >= 3) this.actions.selectParagraph(hit.offset);
      else this.actions.selectWord(hit.offset);
      this.actions.showHandles(true);
      this.actions.focus();
      this.tap = null;
      this.begin(event, true);
      return;
    }

    // ここで焦点を入れると、なぞっただけでキーボードが出てくる。離すまで待つ
    this.tap = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.waitForLongPress(event);
  }

  private move(event: PointerEvent): void {
    if (this.tap?.id === event.pointerId) {
      // 指が動いたならスクロール。叩いた扱いも長押しもやめる
      if (this.movedFromTap(event, this.tap)) this.forgetTap();
      return;
    }
    if (!this.drag) return;
    // 掴んだ側は置いたまま伸ばす。長押しからのときは、キャレットごと動かす
    this.actions.placeCaret(this.layout.hitTest(event.clientX, event.clientY), this.drag.extend);
  }

  private up(event: PointerEvent): void {
    this.cancelLongPress();
    const tap = this.tap;
    this.tap = null;
    if (tap?.id === event.pointerId && !this.movedFromTap(event, tap)) {
      // 置いた場所から動かずに離した = 叩いた。ここで初めて焦点を入れる。
      // 焦点より先に置く。あとで入れないと、古いキャレットを見せる送りに持っていかれる
      this.actions.placeCaret(this.layout.hitTest(event.clientX, event.clientY), event.shiftKey);
      this.actions.showHandles(true);
      this.actions.focus();
    }
    this.stop(event);
  }

  /**
   * 指を置いたまま待たれたら、そのままキャレットを引き回す。
   * 指のドラッグはスクロールに使っているので、置き直したいという意思はここでしか拾えない
   */
  private waitForLongPress(event: PointerEvent): void {
    const view = this.surface.ownerDocument.defaultView;
    if (!view) return;
    this.cancelLongPress();
    const { pointerId, clientX, clientY } = event;
    this.longPress = view.setTimeout(() => {
      this.longPress = 0;
      if (this.tap?.id !== pointerId) return;
      // 掴んだ扱いにする。離しても置き直しはしない
      this.tap = null;
      this.lastTap = null;
      this.taps = 0;
      this.actions.placeCaret(this.layout.hitTest(clientX, clientY), false);
      this.actions.showHandles(true);
      this.actions.focus();
      this.begin(event, false);
    }, LONG_PRESS);
  }

  /** つまみを掴む。ここから先は、動かした先へ端を伸ばすだけ */
  private grab(event: PointerEvent, handle: Handle): void {
    this.forgetTap();
    this.actions.grabHandle(handle);
    this.begin(event, true);
  }

  private begin(event: PointerEvent, extend: boolean): void {
    this.drag = { extend };
    this.surface.setPointerCapture(event.pointerId);
  }

  private stop(event: PointerEvent): void {
    if (!this.drag) return;
    this.drag = null;
    if (this.surface.hasPointerCapture(event.pointerId)) {
      this.surface.releasePointerCapture(event.pointerId);
    }
  }

  /** 叩いた扱いをやめる。続けて叩いた数も切る */
  private forgetTap(): void {
    this.tap = null;
    this.lastTap = null;
    this.taps = 0;
    this.cancelLongPress();
  }

  private cancelLongPress(): void {
    if (!this.longPress) return;
    this.surface.ownerDocument.defaultView?.clearTimeout(this.longPress);
    this.longPress = 0;
  }

  /** 続けて叩いたと言えるか。間隔と、指のずれの両方で見る */
  private isNearInTime(
    event: PointerEvent,
    previous: { at: number; x: number; y: number },
  ): boolean {
    return (
      event.timeStamp - previous.at < DOUBLE_TAP &&
      Math.abs(event.clientX - previous.x) <= DOUBLE_TAP_SLOP &&
      Math.abs(event.clientY - previous.y) <= DOUBLE_TAP_SLOP
    );
  }

  /** 指がスクロールと言えるだけ動いたか */
  private movedFromTap(event: PointerEvent, tap: { x: number; y: number } | null): boolean {
    if (!tap) return false;
    return Math.abs(event.clientX - tap.x) > TAP_SLOP || Math.abs(event.clientY - tap.y) > TAP_SLOP;
  }
}
