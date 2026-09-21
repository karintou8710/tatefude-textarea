import type { Caret, Goal } from "../../text/caret";
import type { ResolvedOptions } from "../../types";
import type { Backend, CaretRect, Handle, ViewState } from "../backend";
import { CaretBlink } from "../blink";
import { ContainerStyle } from "../container";
import { fontBoxSize } from "../font-box";
import {
  caretGeometry,
  contentBreadth,
  contentLength,
  type Geometry,
  lineIndexOfOffset,
  offsetFromPoint,
  selectionRects,
  totalBreadth,
} from "./geometry";
import { type Layout, layoutText } from "./layout";
import { CanvasMeasurer, cssFont } from "./measure";
import { moveAcrossLines, moveToLineEdge } from "./movement";
import { Renderer } from "./renderer";
import { CanvasScroller, type ScrollHost } from "./scroller";
import type { CanvasStyle } from "./style";

/** 字を 1 つずつ canvas に置く。行分割も禁則も字の向きも自前 */
export class CanvasBackend implements Backend {
  /** スクロールコンテナ。ポインタもここで受ける */
  readonly surface: HTMLElement;

  /** 見えている範囲だけを描く面。スクロールしても動かさず、描き直す */
  private canvas: HTMLCanvasElement;
  /** スクロール量をブラウザに持たせるための場所取り */
  private spacer: HTMLElement;

  private measurer: CanvasMeasurer;
  private renderer: Renderer;
  private options: ResolvedOptions;
  private geometry: Geometry;

  private layout: Layout = { lines: [], maxLineLength: 0 };
  private placeholderLayout: Layout | null = null;
  private state: ViewState | null = null;
  private blink = new CaretBlink(() => this.schedule());
  private containerStyle: ContainerStyle;
  private scroller: CanvasScroller;
  /** 字の大きさやコンテナの寸法が変わったらレイアウトし直す */
  private needsLayout = true;

  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private disposers: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    options: ResolvedOptions,
    /** 生成時に決まる。canvas は公開しないので動かす経路が無い */
    private style: CanvasStyle,
  ) {
    this.options = options;
    // 中身を絶対配置で重ねるので、コンテナに位置の基準を入れてから作る。
    // 寸法を CSS から読むので、クラスも読む前に当てる
    this.containerStyle = new ContainerStyle(container);
    this.containerStyle.setClassName(options.className);
    const doc = container.ownerDocument;

    // 描く面は下に敷く。上に重なるスクロールコンテナは透明なので素通しで見え、
    // スクロールバーは上に出る。DOM 順は surface が先 (ポインタの受け口を第一子に保つ)
    this.canvas = doc.createElement("canvas");
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      zIndex: "0",
    } satisfies Partial<CSSStyleDeclaration>);

    // 慣性もラバーバンドもブラウザに任せる。中身は spacer で場所だけ取る
    this.surface = doc.createElement("div");
    Object.assign(this.surface.style, {
      position: "absolute",
      inset: "0",
      zIndex: "1",
    } satisfies Partial<CSSStyleDeclaration>);
    this.spacer = doc.createElement("div");
    this.surface.appendChild(this.spacer);

    container.append(this.surface, this.canvas);

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("tatefude-textarea: 2d コンテキストが取れない");

    const { font, padding } = this.style;
    this.measurer = new CanvasMeasurer(ctx, font);
    this.renderer = new Renderer(ctx, () => this.options, this.style);
    this.geometry = {
      writingMode: options.writingMode,
      width: 0,
      height: 0,
      padding,
      lineHeight: font.size * font.lineHeight,
      em: font.size,
      textBox: fontBoxSize(container.ownerDocument, cssFont(font), font.size),
      scroll: 0,
    };

    this.scroller = new CanvasScroller(this.scrollHost());
    this.applySurfaceStyles();
    this.observeResize();
    this.syncSize();
  }

  get fontSize(): number {
    return this.style.font.size;
  }

  /** 寸法は生成時に凍っているので、読み直すものが無い */
  refresh(): void {}

  setOptions(options: ResolvedOptions): void {
    this.options = options;
    this.containerStyle.setClassName(options.className);
    // 寸法は生成時に凍っているので、ここで動くのは writingMode と色だけ
    this.geometry = { ...this.geometry, writingMode: options.writingMode };
    this.needsLayout = true;
    this.applySurfaceStyles();
  }

  update(state: ViewState): void {
    const changed = this.needsLayout || this.state?.text !== state.text;
    this.state = state;
    if (changed) this.relayout();
    this.schedule();
  }

  get lineCount(): number {
    return this.layout.lines.length;
  }

  linesPerPage(): number {
    return Math.max(1, Math.floor(contentBreadth(this.geometry) / this.geometry.lineHeight));
  }

  hitTest(clientX: number, clientY: number): Caret {
    const rect = this.surface.getBoundingClientRect();
    const { offset, line } = offsetFromPoint(
      this.layout,
      this.geometry,
      clientX - rect.left,
      clientY - rect.top,
    );
    // 折り返しの境目を突いたときは、押した行の側に着ける
    return { offset, preferEnd: line === lineIndexOfOffset(this.layout, offset, true) };
  }

  /** 指で掴むつまみは dom 経路だけで持つ。canvas は出さない */
  hitHandle(): Handle | null {
    return null;
  }

  caretRect(caret: Caret): CaretRect {
    return caretGeometry(this.layout, this.geometry, caret.offset, caret.preferEnd);
  }

  selectionRect(start: number, end: number): CaretRect | null {
    const rects = selectionRects(this.layout, this.geometry, start, end);
    if (rects.length === 0) return null;
    let [left, top, right, bottom] = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const rect of rects) {
      left = Math.min(left, rect.x);
      top = Math.min(top, rect.y);
      right = Math.max(right, rect.x + rect.width);
      bottom = Math.max(bottom, rect.y + rect.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal } {
    return moveAcrossLines(this.layout, caret, direction, goal);
  }

  lineEdge(caret: Caret, edge: "start" | "end"): Caret {
    return moveToLineEdge(this.layout, caret, edge);
  }

  // ---- 送り。中身は CanvasScroller ----

  /** 送りがレイアウトから引くもの。レイアウトのたびに変わるので、値ではなく読み方を渡す */
  private scrollHost(): ScrollHost {
    return {
      surface: this.surface,
      vertical: () => this.vertical,
      lineHeight: () => this.geometry.lineHeight,
      visibleBreadth: () => contentBreadth(this.geometry),
      totalBreadth: () => totalBreadth(this.layout, this.geometry),
      lineOf: (caret) => lineIndexOfOffset(this.layout, caret.offset, caret.preferEnd),
      blockCenterOf: (caret) => {
        const rect = this.caretRect(caret);
        return this.vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
      },
      scrolled: () => this.syncScroll(),
      state: () => this.state,
    };
  }

  get scrollOffset(): number {
    return this.scroller.scrollOffset;
  }

  set scrollOffset(value: number) {
    this.scroller.scrollOffset = value;
  }

  show(state: ViewState): void {
    // 本文や選択が動いた。キャレットは出た状態から数え直す
    this.blink.sync(state.focused, this.options.caretBlinkInterval);
    this.update(state);
    this.scroller.ensureVisible(state.caret);
    // 送りが落ち着いたいま、キャレットが画面のどこに居るかを控える。
    // 次のレイアウトで、そこへ戻す
    this.scroller.anchorCaret();
  }

  forgetAnchor(): void {
    this.scroller.forgetAnchor();
  }

  destroy(): void {
    this.blink.stop();
    this.containerStyle.destroy();
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.scroller.destroy();
    this.resizeObserver?.disconnect();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.measurer.destroy();
    this.canvas.remove();
    this.surface.remove();
  }

  // ---- 内側 ----

  private get vertical(): boolean {
    return this.options.writingMode === "vertical-rl";
  }

  /**
   * surface 自身を writingMode に置くと、送り方向のはみ出しがスクロール領域になる。
   * touch-action を送り方向だけ開けて、パンはブラウザ、タップと長押しは pointer 側で拾う
   */
  private applySurfaceStyles(): void {
    const vertical = this.vertical;
    Object.assign(this.surface.style, {
      writingMode: this.options.writingMode,
      overflowX: vertical ? "auto" : "hidden",
      overflowY: vertical ? "hidden" : "auto",
      touchAction: vertical ? "pan-x" : "pan-y",
      // 縦組みの I ビームは横向き。text は横書き用
      cursor: vertical ? "vertical-text" : "text",
    } satisfies Partial<CSSStyleDeclaration>);
  }

  /** スクロールできる量を maxScroll に合わせる。コンテナのぶんを足した大きさが要る */
  private syncSpacer(): void {
    const vertical = this.vertical;
    const visible = vertical ? this.surface.clientWidth : this.surface.clientHeight;
    const extent = visible + this.scroller.maxScroll();
    Object.assign(this.spacer.style, {
      width: vertical ? `${extent}px` : "1px",
      height: vertical ? "1px" : `${extent}px`,
    } satisfies Partial<CSSStyleDeclaration>);
  }

  /** ブラウザが動かしたスクロール位置を描画側へ移す */
  private syncScroll(): void {
    const scroll = this.scrollOffset;
    if (this.geometry.scroll === scroll) return;
    this.geometry = { ...this.geometry, scroll };
    this.schedule();
  }

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      // コンテナが変われば行の長さも変わって全部レイアウトし直される。
      // 送れる上限を先に直しておかないと、このあとの送りが古い上限で丸められる
      this.syncGeometry();
      // 書いている最中なら、キャレットが画面の外に流れないように追う。
      // ここで正解が出るので、rAF は丸められていたときの保険で足りる
      this.scroller.follow();
      this.scroller.scheduleFollow();
      this.schedule();
    });
    this.resizeObserver.observe(this.container);
  }

  /**
   * 寸法 → レイアウト → 送れる上限 の順に揃える。
   * 上限はレイアウトの結果から決まるので、レイアウトし直したあとでないと古い値のままになる。
   * そのあとに送ると、送りがその古い上限で丸められる
   */
  private syncGeometry(): void {
    this.syncSize();
    this.relayout();
  }

  private syncSize(): void {
    const dpr = this.container.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      // canvas のサイズを変えると 2d コンテキストの状態が落ちる
      this.measurer.applyFont();
      this.needsLayout = true;
    }
    this.geometry = { ...this.geometry, width, height };
    this.syncSpacer();
    this.syncScroll();
  }

  private relayout(): void {
    const maxLineLength = contentLength(this.geometry);
    const kinsoku = this.style.kinsoku;
    this.layout = layoutText({
      text: this.state?.text ?? "",
      maxLineLength,
      measurer: this.measurer,
      kinsoku,
      writingMode: this.options.writingMode,
    });
    const placeholder = this.state?.placeholder;
    this.placeholderLayout = placeholder
      ? layoutText({
          text: placeholder,
          maxLineLength,
          measurer: this.measurer,
          kinsoku,
          writingMode: this.options.writingMode,
        })
      : null;
    this.syncSpacer();
    this.syncScroll();
    this.needsLayout = false;
  }

  private schedule(): void {
    if (this.destroyed || this.frame) return;
    const view = this.container.ownerDocument.defaultView;
    if (!view) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const state = this.state;
    if (this.destroyed || !state || this.geometry.width === 0) return;
    const dpr = this.container.ownerDocument.defaultView?.devicePixelRatio ?? 1;

    this.renderer.render(
      {
        layout: this.layout,
        geometry: this.geometry,
        selection: state.selection,
        caret: state.caretVisible && this.blink.on ? state.caret : null,
        focused: state.focused,
        composition: state.composition,
        placeholder: this.placeholderLayout,
      },
      dpr,
    );
  }
}
