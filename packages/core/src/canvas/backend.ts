import type { Backend, CaretRect, ViewState } from "../backend";
import {
  caretGeometry,
  contentBreadth,
  contentLength,
  type Geometry,
  lineIndexOfOffset,
  offsetFromPoint,
  totalBreadth,
} from "../layout/geometry";
import { type Layout, layoutText } from "../layout/layout";
import { CanvasMeasurer } from "../layout/measure";
import type { Caret, Goal } from "../model/movement";
import { moveAcrossLines, moveToLineEdge } from "../model/movement";
import { Renderer } from "../render/renderer";
import type { ResolvedOptions } from "../types";

/** 字を 1 つずつ canvas に置く。行分割も禁則も字の向きも自前 */
export class CanvasBackend implements Backend {
  readonly surface: HTMLCanvasElement;

  private measurer: CanvasMeasurer;
  private renderer: Renderer;
  private options: ResolvedOptions;
  private geometry: Geometry;
  private scroll = 0;

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
    this.surface = container.ownerDocument.createElement("canvas");
    Object.assign(this.surface.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      // 縦組みの I ビームは横向き。text は横書き用
      cursor: "vertical-text",
      touchAction: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.surface);

    const ctx = this.surface.getContext("2d");
    if (!ctx) throw new Error("canvas-vert-textarea: 2d コンテキストが取れない");

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

  get scrollOffset(): number {
    return this.scroll;
  }

  set scrollOffset(value: number) {
    this.scroll = this.clampScroll(value);
    this.geometry = { ...this.geometry, scroll: this.scroll };
    this.schedule();
  }

  ensureVisible(caret: Caret): void {
    if (this.geometry.width === 0) return;
    const index = lineIndexOfOffset(this.layout, caret.offset, caret.preferEnd);
    const { lineHeight, padding, width } = this.geometry;
    // scroll を無視した、行の左端と右端
    const right = width - padding.right - lineHeight * index;
    const left = right - lineHeight;

    let scroll = this.scroll;
    if (left + scroll < padding.left) scroll = padding.left - left;
    else if (right + scroll > width - padding.right) scroll = width - padding.right - right;

    this.scroll = this.clampScroll(scroll);
    this.geometry = { ...this.geometry, scroll: this.scroll };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.surface.remove();
  }

  // ---- 内側 ----

  private bindWheel(): void {
    const listener = (event: WheelEvent) => {
      if (this.maxScroll() <= 0) return;
      event.preventDefault();
      // 縦書きは左へ読み進む。ホイール下と左スワイプで先へ送る
      this.scrollOffset = this.scroll + event.deltaY - event.deltaX;
    };
    this.surface.addEventListener("wheel", listener, { passive: false });
    this.disposers.push(() => this.surface.removeEventListener("wheel", listener));
  }

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSize();
      this.relayout();
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

    if (this.surface.width !== pixelWidth || this.surface.height !== pixelHeight) {
      this.surface.width = pixelWidth;
      this.surface.height = pixelHeight;
      // canvas のサイズを変えると 2d コンテキストの状態が落ちる
      this.measurer.applyFont();
      this.needsLayout = true;
    }
    this.geometry = { ...this.geometry, width, height, scroll: this.scroll };
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
    this.scroll = this.clampScroll(this.scroll);
    this.geometry = { ...this.geometry, scroll: this.scroll };
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
