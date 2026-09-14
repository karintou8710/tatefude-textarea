import { HiddenInput } from "./input/hidden-input";
import {
  caretGeometry,
  contentBreadth,
  contentLength,
  type Geometry,
  lineIndexOfOffset,
  offsetFromPoint,
  totalBreadth,
} from "./layout/geometry";
import { type Layout, layoutText } from "./layout/layout";
import { CanvasMeasurer } from "./layout/measure";
import type { EditKind } from "./model/history";
import { History } from "./model/history";
import {
  type Caret,
  type Goal,
  moveAcrossLines,
  moveInline,
  movePage,
  moveToLineEdge,
} from "./model/movement";
import type { CompositionRange } from "./render/renderer";
import { Renderer } from "./render/renderer";
import { stepGrapheme, stepWord } from "./text/segment";
import {
  type CanvasVertTextareaOptions,
  type ResolvedOptions,
  resolveOptions,
  type Selection,
} from "./types";

interface Composition {
  /** 変換中の文字列が入る、確定済みテキスト上の位置 */
  start: number;
  text: string;
  activeStart: number;
  activeEnd: number;
}

export interface SetValueOptions {
  selection?: Selection;
  /** onChange を呼ぶか。既定では呼ばない */
  notify?: boolean;
  keepHistory?: boolean;
}

export class CanvasVertTextarea {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;

  private measurer: CanvasMeasurer;
  private renderer: Renderer;
  private input: HiddenInput;
  private history = new History();
  private options: ResolvedOptions;
  private callbacks: CanvasVertTextareaOptions;

  private text = "";
  private anchor = 0;
  private caret: Caret = { offset: 0, preferEnd: false };
  private goal: Goal = null;
  private composition: Composition | null = null;

  private layout: Layout = { lines: [], maxLineLength: 0 };
  private placeholderLayout: Layout | null = null;
  private geometry: Geometry;
  private scroll = 0;

  private focused = false;
  private caretOn = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private dragging = false;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement, options: CanvasVertTextareaOptions = {}) {
    this.container = container;
    this.callbacks = options;
    this.options = resolveOptions(options);

    const doc = container.ownerDocument;
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.style.overflow = "hidden";

    this.canvas = doc.createElement("canvas");
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      cursor: "text",
      touchAction: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas-vert-textarea: 2d コンテキストが取れない");

    this.measurer = new CanvasMeasurer(ctx, this.options.font);
    this.renderer = new Renderer(ctx, this.options);
    this.geometry = {
      width: 0,
      height: 0,
      padding: this.options.padding,
      lineHeight: this.options.font.size * this.options.font.lineHeight,
      em: this.options.font.size,
      scroll: 0,
    };

    this.input = new HiddenInput(container, {
      insert: (text) => this.handleInsert(text),
      compositionStart: () => this.handleCompositionStart(),
      compositionUpdate: (text, from, to) => this.handleCompositionUpdate(text, from, to),
      compositionEnd: (text) => this.handleCompositionEnd(text),
      keyDown: (event) => this.handleKeyDown(event),
      copy: () => this.selectedText,
      cut: () => this.handleCut(),
      paste: (text) => this.handleInsert(text),
      focus: () => this.handleFocus(),
      blur: () => this.handleBlur(),
    });
    this.input.setReadOnly(this.options.readOnly);
    this.input.setDisabled(this.options.disabled);

    this.bindPointer();
    this.observeResize();

    // textarea と同じで、初期のキャレットは文頭に置く
    this.text = normalize(options.value ?? "");
    this.syncSize();
    this.relayout();
    this.schedule();
  }

  // ---- 公開 API ----

  get value(): string {
    return this.text;
  }

  set value(value: string) {
    this.setValue(value);
  }

  setValue(value: string, options: SetValueOptions = {}): void {
    const next = normalize(value);
    if (next === this.text && !options.selection) return;
    if (!options.keepHistory) this.history.clear();

    this.text = next;
    const selection = options.selection ?? { anchor: this.anchor, focus: this.caret.offset };
    this.anchor = clamp(selection.anchor, 0, next.length);
    this.caret = { offset: clamp(selection.focus, 0, next.length), preferEnd: false };
    this.goal = null;
    this.composition = null;

    this.relayout();
    this.ensureCaretVisible();
    this.schedule();
    if (options.notify) this.callbacks.onChange?.(this.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  get selection(): Selection {
    return { anchor: this.anchor, focus: this.caret.offset };
  }

  set selection(selection: Selection) {
    this.setSelection(selection.anchor, selection.focus);
  }

  setSelection(anchor: number, focus = anchor): void {
    this.anchor = clamp(anchor, 0, this.text.length);
    this.caret = { offset: clamp(focus, 0, this.text.length), preferEnd: false };
    this.goal = null;
    this.history.breakCoalescing();
    this.afterSelectionChange();
  }

  selectAll(): void {
    this.setSelection(0, this.text.length);
  }

  get selectedText(): string {
    const [from, to] = this.range();
    return this.text.slice(from, to);
  }

  insertText(text: string): void {
    this.handleInsert(text);
  }

  focus(): void {
    this.input.focus();
  }

  blur(): void {
    this.input.blur();
  }

  undo(): void {
    const snapshot = this.history.undo({ text: this.text, selection: this.selection });
    if (!snapshot) return;
    this.applySnapshot(snapshot);
  }

  redo(): void {
    const snapshot = this.history.redo({ text: this.text, selection: this.selection });
    if (!snapshot) return;
    this.applySnapshot(snapshot);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  setOptions(options: CanvasVertTextareaOptions): void {
    this.callbacks = { ...this.callbacks, ...options };
    this.options = resolveOptions(this.callbacks);
    this.measurer.setFont(this.options.font);
    this.renderer.setOptions(this.options);
    this.input.setReadOnly(this.options.readOnly);
    this.input.setDisabled(this.options.disabled);
    this.geometry = {
      ...this.geometry,
      padding: this.options.padding,
      lineHeight: this.options.font.size * this.options.font.lineHeight,
      em: this.options.font.size,
    };
    this.startBlink();
    this.relayout();
    this.ensureCaretVisible();
    this.schedule();
  }

  /** 行送り方向にどれだけ送られているか (px) */
  get scrollOffset(): number {
    return this.scroll;
  }

  set scrollOffset(value: number) {
    this.scroll = this.clampScroll(value);
    this.geometry = { ...this.geometry, scroll: this.scroll };
    this.schedule();
  }

  /** 折り返しを含めた視覚行の数 */
  get lineCount(): number {
    return this.layout.lines.length;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopBlink();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.input.destroy();
    this.canvas.remove();
  }

  // ---- 入力 ----

  private handleInsert(raw: string): void {
    if (this.options.readOnly || this.options.disabled) return;
    const text = normalize(raw);
    if (!text) return;
    const [from, to] = this.range();
    this.replace(from, to, text, "input");
  }

  private handleCut(): string {
    const selected = this.selectedText;
    if (!this.options.readOnly && !this.options.disabled && selected) {
      const [from, to] = this.range();
      this.replace(from, to, "", "delete");
    }
    return selected;
  }

  private handleCompositionStart(): void {
    if (this.options.readOnly || this.options.disabled) return;
    const [from, to] = this.range();
    if (from !== to) this.replace(from, to, "", "delete");
    this.history.breakCoalescing();
    this.composition = { start: this.caret.offset, text: "", activeStart: 0, activeEnd: 0 };
    this.relayout();
    this.schedule();
  }

  private handleCompositionUpdate(text: string, activeStart: number, activeEnd: number): void {
    if (!this.composition) return;
    this.composition = { ...this.composition, text, activeStart, activeEnd };
    this.relayout();
    this.ensureCaretVisible();
    this.schedule();
  }

  private handleCompositionEnd(text: string): void {
    const composition = this.composition;
    this.composition = null;
    if (!composition) return;
    if (text) {
      this.replace(composition.start, composition.start, normalize(text), "other");
    } else {
      this.relayout();
      this.schedule();
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.options.disabled) return;
    const accel = event.metaKey || event.ctrlKey;
    const shift = event.shiftKey;
    const word = event.altKey;

    switch (event.key) {
      // 縦書きでは行の中は上下、行送りは左右
      case "ArrowDown":
        event.preventDefault();
        this.moveCaret(
          accel
            ? moveToLineEdge(this.layout, this.caret, "end")
            : moveInline(this.text, this.caret, 1, word),
          shift,
        );
        return;
      case "ArrowUp":
        event.preventDefault();
        this.moveCaret(
          accel
            ? moveToLineEdge(this.layout, this.caret, "start")
            : moveInline(this.text, this.caret, -1, word),
          shift,
        );
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (accel) this.moveCaret({ offset: this.text.length, preferEnd: true }, shift);
        else this.moveAcross(1, shift);
        return;
      case "ArrowRight":
        event.preventDefault();
        if (accel) this.moveCaret({ offset: 0, preferEnd: false }, shift);
        else this.moveAcross(-1, shift);
        return;
      case "Home":
        event.preventDefault();
        this.moveCaret(moveToLineEdge(this.layout, this.caret, "start"), shift);
        return;
      case "End":
        event.preventDefault();
        this.moveCaret(moveToLineEdge(this.layout, this.caret, "end"), shift);
        return;
      case "PageDown":
      case "PageUp": {
        event.preventDefault();
        const step = event.key === "PageDown" ? 1 : -1;
        const result = movePage(this.layout, this.caret, step, this.linesPerPage(), this.goal);
        this.moveCaret(result.caret, shift, result.goal);
        return;
      }
      case "Backspace":
        event.preventDefault();
        this.deleteBy(-1, word);
        return;
      case "Delete":
        event.preventDefault();
        this.deleteBy(1, word);
        return;
      case "Enter":
        event.preventDefault();
        this.handleInsert("\n");
        return;
      case "Escape":
        return;
      default:
        break;
    }

    if (accel && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if (accel && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (shift) this.redo();
      else this.undo();
      return;
    }
    if (accel && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
    }
  }

  private deleteBy(direction: 1 | -1, byWord: boolean): void {
    if (this.options.readOnly || this.options.disabled) return;
    const [from, to] = this.range();
    if (from !== to) {
      this.replace(from, to, "", "delete");
      return;
    }
    const at = this.caret.offset;
    const other = byWord
      ? stepWord(this.text, at, direction)
      : stepGrapheme(this.text, at, direction);
    if (other === at) return;
    this.replace(Math.min(at, other), Math.max(at, other), "", "delete");
  }

  private replace(from: number, to: number, insert: string, kind: EditKind): void {
    const room = this.options.maxLength - (this.text.length - (to - from));
    const text = room >= insert.length ? insert : insert.slice(0, Math.max(0, room));
    if (from === to && text.length === 0) return;

    this.history.push({ text: this.text, selection: this.selection }, kind);
    this.text = this.text.slice(0, from) + text + this.text.slice(to);

    const at = from + text.length;
    this.anchor = at;
    this.caret = { offset: at, preferEnd: true };
    this.goal = null;

    this.relayout();
    this.ensureCaretVisible();
    this.resetBlink();
    this.schedule();
    this.callbacks.onChange?.(this.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  private applySnapshot(snapshot: { text: string; selection: Selection }): void {
    this.text = snapshot.text;
    this.anchor = clamp(snapshot.selection.anchor, 0, this.text.length);
    this.caret = { offset: clamp(snapshot.selection.focus, 0, this.text.length), preferEnd: false };
    this.goal = null;
    this.composition = null;
    this.relayout();
    this.ensureCaretVisible();
    this.schedule();
    this.callbacks.onChange?.(this.text);
    this.callbacks.onSelectionChange?.(this.selection);
  }

  // ---- 選択 ----

  private range(): [number, number] {
    const a = this.anchor;
    const b = this.caret.offset;
    return a <= b ? [a, b] : [b, a];
  }

  private moveCaret(caret: Caret, extend: boolean, goal: Goal = null): void {
    this.caret = caret;
    this.goal = goal;
    if (!extend) this.anchor = caret.offset;
    this.history.breakCoalescing();
    this.afterSelectionChange();
  }

  private moveAcross(direction: 1 | -1, extend: boolean): void {
    const result = moveAcrossLines(this.layout, this.caret, direction, this.goal);
    this.moveCaret(result.caret, extend, result.goal);
  }

  private afterSelectionChange(): void {
    this.ensureCaretVisible();
    this.resetBlink();
    this.schedule();
    this.callbacks.onSelectionChange?.(this.selection);
  }

  // ---- ポインタ ----

  private bindPointer(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, listener as EventListener, options);
      this.disposers.push(() =>
        target.removeEventListener(type, listener as EventListener, options),
      );
    };

    on(this.canvas, "pointerdown", (event) => {
      if (event.button !== 0 || this.options.disabled) return;
      event.preventDefault();
      this.input.focus();

      const hit = this.hit(event);
      if (event.detail >= 3) {
        this.selectParagraph(hit.offset);
        return;
      }
      if (event.detail === 2) {
        this.selectWord(hit.offset);
        return;
      }

      this.dragging = true;
      this.canvas.setPointerCapture(event.pointerId);
      this.caret = { offset: hit.offset, preferEnd: hit.preferEnd };
      if (!event.shiftKey) this.anchor = hit.offset;
      this.goal = null;
      this.history.breakCoalescing();
      this.afterSelectionChange();
    });

    on(this.canvas, "pointermove", (event) => {
      if (!this.dragging) return;
      const hit = this.hit(event);
      this.caret = { offset: hit.offset, preferEnd: hit.preferEnd };
      this.goal = null;
      this.afterSelectionChange();
    });

    const stop = (event: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };
    on(this.canvas, "pointerup", stop);
    on(this.canvas, "pointercancel", stop);

    on(
      this.canvas,
      "wheel",
      (event) => {
        const max = this.maxScroll();
        if (max <= 0) return;
        event.preventDefault();
        // 縦書きは左へ読み進む。ホイール下と左スワイプで先へ送る
        this.scrollOffset = this.scroll + event.deltaY - event.deltaX;
      },
      { passive: false },
    );
  }

  private hit(event: PointerEvent): { offset: number; preferEnd: boolean } {
    const rect = this.canvas.getBoundingClientRect();
    const { offset, line } = offsetFromPoint(
      this.layout,
      this.geometry,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    // 折り返しの境目を突いたときは、押した行の側に着ける
    return { offset, preferEnd: line === lineIndexOfOffset(this.layout, offset, true) };
  }

  private selectWord(offset: number): void {
    const from = stepWord(this.text, Math.min(offset + 1, this.text.length), -1);
    const to = stepWord(this.text, from, 1);
    this.setSelection(from, to);
  }

  private selectParagraph(offset: number): void {
    const from = this.text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const found = this.text.indexOf("\n", offset);
    this.setSelection(from, found === -1 ? this.text.length : found);
  }

  // ---- 見た目 ----

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSize();
      this.relayout();
      this.ensureCaretVisible();
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
    }
    this.geometry = { ...this.geometry, width, height, scroll: this.scroll };
  }

  private relayout(): void {
    const maxLineLength = contentLength(this.geometry);
    this.layout = layoutText({
      text: this.displayText(),
      maxLineLength,
      measurer: this.measurer,
      kinsoku: this.options.kinsoku,
    });
    this.placeholderLayout =
      this.text.length === 0 && !this.composition && this.options.placeholder
        ? layoutText({
            text: this.options.placeholder,
            maxLineLength,
            measurer: this.measurer,
            kinsoku: this.options.kinsoku,
          })
        : null;
    this.scroll = this.clampScroll(this.scroll);
    this.geometry = { ...this.geometry, scroll: this.scroll };
  }

  private displayText(): string {
    const composition = this.composition;
    if (!composition) return this.text;
    return (
      this.text.slice(0, composition.start) + composition.text + this.text.slice(composition.start)
    );
  }

  /** 描画・当たり判定で使う、変換中の文字を含めたキャレット */
  private displayCaret(): Caret {
    const composition = this.composition;
    if (!composition) return this.caret;
    return { offset: composition.start + composition.activeEnd, preferEnd: true };
  }

  private compositionRange(): CompositionRange | null {
    const composition = this.composition;
    if (!composition || composition.text.length === 0) return null;
    return {
      start: composition.start,
      end: composition.start + composition.text.length,
      activeStart: composition.start + composition.activeStart,
      activeEnd: composition.start + composition.activeEnd,
    };
  }

  private linesPerPage(): number {
    return Math.max(1, Math.floor(contentBreadth(this.geometry) / this.geometry.lineHeight));
  }

  private maxScroll(): number {
    return Math.max(0, totalBreadth(this.layout, this.geometry) - contentBreadth(this.geometry));
  }

  private clampScroll(value: number): number {
    return clamp(value, 0, this.maxScroll());
  }

  private ensureCaretVisible(): void {
    if (this.geometry.width === 0) return;
    const caret = this.displayCaret();
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

  private handleFocus(): void {
    this.focused = true;
    this.startBlink();
    this.schedule();
    this.callbacks.onFocus?.();
  }

  private handleBlur(): void {
    this.focused = false;
    this.dragging = false;
    this.stopBlink();
    this.history.breakCoalescing();
    this.schedule();
    this.callbacks.onBlur?.();
  }

  private startBlink(): void {
    this.stopBlink();
    this.caretOn = true;
    const interval = this.options.caretBlinkInterval;
    if (interval <= 0) return;
    this.blinkTimer = setInterval(() => {
      this.caretOn = !this.caretOn;
      this.schedule();
    }, interval);
  }

  private stopBlink(): void {
    if (this.blinkTimer !== null) clearInterval(this.blinkTimer);
    this.blinkTimer = null;
    this.caretOn = true;
  }

  private resetBlink(): void {
    if (this.focused) this.startBlink();
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
    if (this.destroyed || this.geometry.width === 0) return;
    const dpr = this.container.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const caret = this.displayCaret();
    const [from, to] = this.range();

    this.renderer.render(
      {
        layout: this.layout,
        geometry: this.geometry,
        selection: this.composition ? { start: 0, end: 0 } : { start: from, end: to },
        caret: this.caretOn ? caret : null,
        focused: this.focused,
        composition: this.compositionRange(),
        placeholder: this.placeholderLayout,
      },
      dpr,
    );

    // IME の候補ウィンドウをキャレットの隣に出させる
    const rect = caretGeometry(this.layout, this.geometry, caret.offset, caret.preferEnd);
    this.input.moveTo(rect.x - rect.size / 2, rect.y, this.options.font.size);
  }
}

/** 改行を \n に揃える。textarea もクリップボードも \r\n を投げてくる */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
