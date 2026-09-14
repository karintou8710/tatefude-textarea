import type { Layout, Scroller } from "../backend/backend";
import type { Caret } from "../model/movement";

/** これだけ動いたら、叩いたのではなくスクロール (CSS px) */
const TAP_SLOP = 8;

/** ジェスチャが決まったときに呼ぶ先。選択の作り方は Textarea 側が持つ */
export interface PointerActions {
  disabled(): boolean;
  placeCaret(caret: Caret, extend: boolean): void;
  selectWord(offset: number): void;
  selectParagraph(offset: number): void;
  focus(): void;
}

/**
 * 指とマウスの受け口。
 *
 * 組みからは「突いた場所が何文字目か」(Layout) と
 * 「戻す先を忘れる」(Scroller) しか要らないので、その 2 つだけ受ける。
 */
export class PointerGestures {
  private dragging = false;
  /** 指を置いた場所。離すまでは、叩いたのかスクロールなのか決まらない */
  private tap: { id: number; x: number; y: number } | null = null;
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
    this.dragging = false;
  }

  destroy(): void {
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

    on("pointerdown", (event) => this.down(event));
    on("pointermove", (event) => this.move(event));
    on("pointerup", (event) => this.up(event));
    on("pointercancel", (event) => {
      // ブラウザがパンを取った
      this.tap = null;
      this.stop(event);
    });
  }

  private down(event: PointerEvent): void {
    if (event.button !== 0 || this.actions.disabled()) return;
    event.preventDefault();
    // 触り直した。指でパンするならもう戻す先ではないし、叩くなら下で置き直す
    this.scroller.forgetAnchor();

    // 指はスワイプでスクロールさせたい。ここで焦点を入れると、
    // なぞっただけでキーボードが出てくる。離すまで何もしない。
    // ドラッグ選択もしない。ブラウザがパンと決めるまでの数 px が選ばれて残るし、
    // ポインタを捕らえるとパン自体を邪魔する
    if (event.pointerType === "touch") {
      this.tap = { id: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }

    // 測る → 置く → 焦点、の順。焦点を先に入れると、その時点の
    // 古いキャレットを見せるために送りが動き、突いた場所が画面ごとずれる
    const hit = this.layout.hitTest(event.clientX, event.clientY);
    if (event.detail >= 3) {
      this.actions.selectParagraph(hit.offset);
    } else if (event.detail === 2) {
      this.actions.selectWord(hit.offset);
    } else {
      this.dragging = true;
      this.surface.setPointerCapture(event.pointerId);
      this.actions.placeCaret(hit, event.shiftKey);
    }
    this.actions.focus();
  }

  private move(event: PointerEvent): void {
    if (this.tap?.id === event.pointerId) {
      // 指が動いたならスクロール。叩いた扱いをやめる
      if (this.movedFromTap(event, this.tap)) this.tap = null;
      return;
    }
    if (!this.dragging) return;
    // 掴んだ側は置いたまま伸ばす
    this.actions.placeCaret(this.layout.hitTest(event.clientX, event.clientY), true);
  }

  private up(event: PointerEvent): void {
    const tap = this.tap;
    this.tap = null;
    if (tap?.id === event.pointerId && !this.movedFromTap(event, tap)) {
      // 置いた場所から動かずに離した = 叩いた。ここで初めて焦点を入れる。
      // 焦点より先に置く。あとで入れないと、古いキャレットを見せる送りに持っていかれる
      this.actions.placeCaret(this.layout.hitTest(event.clientX, event.clientY), event.shiftKey);
      this.actions.focus();
    }
    this.stop(event);
  }

  private stop(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.surface.hasPointerCapture(event.pointerId)) {
      this.surface.releasePointerCapture(event.pointerId);
    }
  }

  /** 指がスクロールと言えるだけ動いたか */
  private movedFromTap(event: PointerEvent, tap: { x: number; y: number } | null): boolean {
    if (!tap) return false;
    return Math.abs(event.clientX - tap.x) > TAP_SLOP || Math.abs(event.clientY - tap.y) > TAP_SLOP;
  }
}
