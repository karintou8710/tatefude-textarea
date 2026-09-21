import type { Caret, Goal } from "../../model/movement";
import type { ResolvedOptions } from "../../types";
import type { Backend, CaretRect, ViewState } from "../backend";
import { readScroll, writeScroll } from "../scroll";
import {
  caretGeometry,
  contentBreadth,
  contentLength,
  type Geometry,
  lineIndexOfOffset,
  offsetFromPoint,
  totalBreadth,
} from "./geometry";
import { type Layout, layoutText } from "./layout";
import { CanvasMeasurer } from "./measure";
import { moveAcrossLines, moveToLineEdge } from "./movement";
import { Renderer } from "./renderer";

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
  /** 字の大きさや器の寸法が変わったら組み直す */
  private needsLayout = true;

  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private disposers: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    options: ResolvedOptions,
  ) {
    this.options = options;
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

    this.measurer = new CanvasMeasurer(ctx, options.font);
    this.renderer = new Renderer(ctx, options);
    this.geometry = {
      writingMode: options.writingMode,
      width: 0,
      height: 0,
      padding: options.padding,
      lineHeight: options.font.size * options.font.lineHeight,
      em: options.font.size,
      scroll: 0,
    };

    this.applySurfaceStyles();
    this.bindScroll();
    this.bindWheel();
    this.observeResize();
    this.syncSize();
  }

  setOptions(options: ResolvedOptions): void {
    this.options = options;
    this.measurer.setFont(options.font);
    this.renderer.setOptions(options);
    this.geometry = {
      ...this.geometry,
      writingMode: options.writingMode,
      padding: options.padding,
      lineHeight: options.font.size * options.font.lineHeight,
      em: options.font.size,
    };
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

  caretRect(caret: Caret): CaretRect {
    return caretGeometry(this.layout, this.geometry, caret.offset, caret.preferEnd);
  }

  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal } {
    return moveAcrossLines(this.layout, caret, direction, goal);
  }

  lineEdge(caret: Caret, edge: "start" | "end"): Caret {
    return moveToLineEdge(this.layout, caret, edge);
  }

  /** 送り方向に読み進んだ量。向きに依らず 0 以上 */
  get scrollOffset(): number {
    return readScroll(this.surface, this.vertical);
  }

  set scrollOffset(value: number) {
    const next = this.clampScroll(value);
    writeScroll(this.surface, this.vertical, next);
    this.syncScroll();
  }

  ensureVisible(caret: Caret): void {
    const breadth = contentBreadth(this.geometry);
    if (breadth === 0) return;
    const index = lineIndexOfOffset(this.layout, caret.offset, caret.preferEnd);
    const { lineHeight } = this.geometry;
    // 送りぶんを引く前の、行の手前と奥 (block 方向)。縦書きなら右端と左端
    const near = lineHeight * index;
    const far = near + lineHeight;

    let scroll = this.scrollOffset;
    if (near - scroll < 0) scroll = near;
    else if (far - scroll > breadth) scroll = far - breadth;

    this.scrollOffset = scroll;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
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

  /** スクロールできる量を maxScroll に合わせる。器のぶんを足した大きさが要る */
  private syncSpacer(): void {
    const vertical = this.vertical;
    const visible = vertical ? this.surface.clientWidth : this.surface.clientHeight;
    const extent = visible + this.maxScroll();
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

  private bindScroll(): void {
    const listener = () => this.syncScroll();
    this.surface.addEventListener("scroll", listener, { passive: true });
    this.disposers.push(() => this.surface.removeEventListener("scroll", listener));
  }

  private bindWheel(): void {
    const listener = (event: WheelEvent) => {
      if (this.maxScroll() <= 0) return;
      event.preventDefault();
      // 縦組みで「下へ回す = 左へ読み進む」になるかはエンジン任せにできない。
      // タッチのパンは touch-action に任せてあるので、ここは通らない
      this.scrollOffset =
        this.scrollOffset + (this.vertical ? event.deltaY - event.deltaX : event.deltaY);
    };
    this.surface.addEventListener("wheel", listener, { passive: false });
    this.disposers.push(() => this.surface.removeEventListener("wheel", listener));
  }

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSize();
      this.relayout();
      // 器が変われば行の長さも変わって全部組み直る。
      // 書いている最中なら、キャレットが画面の外に流れないように追う
      if (this.state?.focused) this.ensureVisible(this.state.caret);
      this.schedule();
    });
    this.resizeObserver.observe(this.container);
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
    const kinsoku = this.options.kinsoku;
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

  private maxScroll(): number {
    return Math.max(0, totalBreadth(this.layout, this.geometry) - contentBreadth(this.geometry));
  }

  private clampScroll(value: number): number {
    return value < 0 ? 0 : Math.min(value, this.maxScroll());
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
        caret: state.caretVisible ? state.caret : null,
        focused: state.focused,
        composition: state.composition,
        placeholder: this.placeholderLayout,
      },
      dpr,
    );
  }
}
