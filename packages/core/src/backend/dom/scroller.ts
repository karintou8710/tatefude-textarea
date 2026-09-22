import type { Caret } from "../../text/caret";
import type { Scroller, ViewState } from "../backend";
import { readScroll, writeScroll } from "../scroll";

/**
 * スクロールがレイアウトから要るものは、これだけ。
 *
 * 値ではなく関数で受けるのは、どれもレイアウトのたびに変わるため。
 * 掴んで持つと、コンテナが縮んだあとに古い寸法でスクロールすることになる。
 */
export interface ScrollHost {
  /** スクロールコンテナ。ホイールもここで拾う */
  readonly surface: HTMLElement;
  vertical(): boolean;
  /** 測った行送り */
  lineHeight(): number;
  /** スクロール方向の余白。手前と奥 */
  padStart(): number;
  padEnd(): number;
  /** レイアウトがスクロール方向に占める長さ */
  contentLength(): number;
  /**
   * キャレットのブロック方向の中心 (surface 基準)。
   * スクロールの自由度は block 方向しかないので、矩形そのものは要らない
   */
  blockCenterOf(caret: Caret): number;
  /** いま表示している状態。まだ何も来ていなければ null */
  state(): ViewState | null;
}

/**
 * スクロール位置だけを持つ。
 *
 * 慣性もラバーバンドもブラウザ側にあるので、ここがやるのは
 * 「いくつスクロールしたか」「どこまでスクロールできるか」「どこへ戻すか」の 3 つ。
 * レイアウトは知らないので、寸法は host から引く。
 */
export class DomScroller implements Scroller {
  /** 次のレイアウトで戻す先。クリックした時点のキャレットの block 座標 */
  private anchor: { block: number; offset: number } | null = null;
  private followFrame = 0;
  private disposers: (() => void)[] = [];
  private destroyed = false;

  constructor(private host: ScrollHost) {
    this.bindWheel();
  }

  /** スクロール方向に読み進んだ量。向きに依らず 0 以上 */
  get scrollOffset(): number {
    return readScroll(this.host.surface, this.host.vertical());
  }

  set scrollOffset(value: number) {
    const next = value < 0 ? 0 : Math.min(value, this.maxScroll());
    writeScroll(this.host.surface, this.host.vertical(), next);
  }

  /** コンテナのうち、余白を除いて見えている長さ */
  visibleBreadth(): number {
    return this.visibleLength() - this.host.padStart() - this.host.padEnd();
  }

  maxScroll(): number {
    return Math.max(0, this.host.contentLength() - this.visibleBreadth());
  }

  ensureVisible(caret: Caret): void {
    const visible = this.visibleLength();
    if (visible === 0) return;
    const vertical = this.host.vertical();
    const lineHeight = this.host.lineHeight();
    const padStart = this.host.padStart();
    const padEnd = this.host.padEnd();

    // 中心はスクロールぶんを含んでいるので、はみ出した差だけ足し引きする
    const center = this.host.blockCenterOf(caret);
    const near = center - lineHeight / 2;
    const far = center + lineHeight / 2;
    const scroll = this.scrollOffset;

    // 縦書きはスクロールを増やすと字が右へ動くので、符号が逆になる
    const sign = vertical ? 1 : -1;
    if (near < padStart) this.scrollOffset = scroll + sign * (padStart - near);
    else if (far > visible - padEnd) {
      this.scrollOffset = scroll - sign * (far - (visible - padEnd));
    }
  }

  anchorCaret(): void {
    const state = this.host.state();
    if (!state) {
      this.anchor = null;
      return;
    }
    this.anchor = { block: this.host.blockCenterOf(state.caret), offset: state.caret.offset };
  }

  forgetAnchor(): void {
    this.anchor = null;
  }

  /**
   * キャレットを追う。同期パスと rAF が同じ答えを出すように、判断はここだけに置く。
   * アンカーは使っても捨てない。キーボードは何段階かに分けてコンテナを縮めてくるので、
   * 1 回使っただけで捨てると 2 段目から戻す先を失う
   */
  follow(): void {
    const state = this.host.state();
    if (this.destroyed || !state) return;
    const anchor = this.anchor;
    if (anchor) {
      // キャレットがあの時のままなら、その場に戻す
      if (anchor.offset === state.caret.offset) this.keepCaretAt(state.caret, anchor.block);
      else this.anchor = null;
    }
    // focus が無いならキャレットを見せる理由もない。キーボードが閉じたあとの
    // レイアウトはここを通る。戻す先があればそれで足りている
    if (!state.focused) return;
    // 戻す先がコンテナの外に出ることがある。キーボードはブロック方向に潰してくるので、
    // 潰れた側をタップしていると戻す先がそのまま画面の外になる。最後に必ず入れ直す
    this.ensureVisible(state.caret);
  }

  /**
   * 確定した寸法でもう一度追う保険。
   * コンテナが変われば列数も変わり、スクロールできる上限 (maxScroll) も変わる。
   * 同期パスでスクロールしきれていれば同じ値になり、見た目には何も起きない
   */
  scheduleFollow(): void {
    const view = this.host.surface.ownerDocument.defaultView;
    if (!view) return;
    if (this.followFrame) view.cancelAnimationFrame(this.followFrame);
    this.followFrame = view.requestAnimationFrame(() => {
      this.followFrame = 0;
      this.follow();
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.followFrame) {
      this.host.surface.ownerDocument.defaultView?.cancelAnimationFrame(this.followFrame);
    }
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }

  /** コンテナの、スクロール方向の長さ。余白を含む */
  private visibleLength(): number {
    const { surface } = this.host;
    return this.host.vertical() ? surface.clientWidth : surface.clientHeight;
  }

  /**
   * キャレットの block 座標を anchor に戻す。
   * スクロールの自由度は block 方向しかないので、inline 方向 (縦書きなら y) はレイアウト任せ
   */
  private keepCaretAt(caret: Caret, anchor: number): void {
    const gap = anchor - this.host.blockCenterOf(caret);
    // 符号は ensureVisible と同じ規則
    this.scrollOffset = this.scrollOffset + (this.host.vertical() ? gap : -gap);
  }

  /**
   * ホイールは自前で受ける。縦組みで「下へ回す = 左へ読み進む」になるかは
   * エンジン任せにできないので、軸の対応をここで決めてしまう。
   * タッチのパンは touch-action に任せてあるので、ここは通らない
   */
  private bindWheel(): void {
    const { surface } = this.host;
    const listener = (event: WheelEvent) => {
      if (this.maxScroll() <= 0) return;
      event.preventDefault();
      // 自分でスクロールした先が見たい位置。クリックした場所へは戻さない
      this.forgetAnchor();
      const delta = this.host.vertical() ? event.deltaY - event.deltaX : event.deltaY;
      this.scrollOffset = this.scrollOffset + delta;
    };
    surface.addEventListener("wheel", listener, { passive: false });
    this.disposers.push(() => surface.removeEventListener("wheel", listener));
  }
}
