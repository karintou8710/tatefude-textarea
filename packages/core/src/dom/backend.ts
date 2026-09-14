import type { Backend, CaretRect, ViewState } from "../backend";
import type { Caret, Goal } from "../model/movement";
import type { ResolvedOptions } from "../types";

/**
 * 組むのはブラウザに任せる。字の向き (UAX #50)・縦組み字形・禁則は
 * writing-mode: vertical-rl の中で解決されるので、こちらは
 * 「どこに何が落ちたか」を Range API で読み返すだけ。
 */
export class DomBackend implements Backend {
  readonly surface: HTMLElement;

  private layer: HTMLElement;
  private content: HTMLElement;
  private placeholder: HTMLElement;
  private selectionLayer: HTMLElement;
  private caretLayer: HTMLElement;

  private options: ResolvedOptions;
  private scroll = 0;
  private state: ViewState | null = null;
  /** content に流し込んだテキスト (末尾の番人を含む) */
  private rendered = "";
  /** テキストのオフセットと、それを持つ Text ノードの対応 */
  private nodes: { node: Text; start: number }[] = [];

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

    this.surface = doc.createElement("div");
    Object.assign(this.surface.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      cursor: "text",
      touchAction: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    // 縦書きの本体。右上を起点に、行が左へ伸びる
    this.layer = doc.createElement("div");
    Object.assign(this.layer.style, {
      position: "absolute",
      willChange: "transform",
    } satisfies Partial<CSSStyleDeclaration>);

    this.content = doc.createElement("div");
    this.placeholder = doc.createElement("div");
    this.selectionLayer = doc.createElement("div");
    this.caretLayer = doc.createElement("div");
    for (const el of [this.selectionLayer, this.caretLayer]) {
      Object.assign(el.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
    }

    // 絶対配置は DOM 順に関わらず通常フローの上に来る。重なりは z-index で決める
    this.selectionLayer.style.zIndex = "0";
    this.caretLayer.style.zIndex = "2";
    this.layer.append(this.selectionLayer, this.content, this.placeholder, this.caretLayer);
    this.surface.appendChild(this.layer);
    container.appendChild(this.surface);

    this.applyStyles();
    this.syncMetrics();
    this.bindWheel();
    this.observeResize();
  }

  /**
   * 行の長さを px で入れる。% のままだと幅を決める段階で高さが未定になり、
   * 直交フローの幅が決まらない。
   */
  private syncMetrics(): void {
    const { padding } = this.options;
    const length = Math.max(0, this.surface.clientHeight - padding.top - padding.bottom);
    const height = `${length}px`;
    this.layer.style.height = height;
    this.content.style.height = height;
    this.placeholder.style.height = height;
    this.syncLayerWidth();
  }

  /**
   * layer の幅は content に合わせる。
   * auto (shrink-to-fit) も max-content も、縦書きの子は直交フローなので
   * Chrome が中身の変更で intrinsic を計算し直さず、桁違いの幅のまま残る。
   * content 自身の幅は行の長さだけで決まるので、測って入れる。
   */
  private syncLayerWidth(): void {
    this.layer.style.width = `${this.content.getBoundingClientRect().width}px`;
  }

  setOptions(options: ResolvedOptions): void {
    this.options = options;
    this.applyStyles();
    this.syncMetrics();
  }

  update(state: ViewState): void {
    const text = state.text + sentinelFor(state.text);
    // 幾何を引く前に要るので、本文だけは同期で流し込む
    if (text !== this.rendered || state.composition !== this.state?.composition) {
      this.writeContent(text, state);
      this.rendered = text;
      this.syncLayerWidth();
    }
    this.state = state;
    this.placeholder.textContent = state.placeholder ?? "";
    this.placeholder.style.display = state.placeholder ? "block" : "none";
    this.schedule();
  }

  get lineCount(): number {
    const width = this.content.getBoundingClientRect().width;
    return Math.max(1, Math.round(width / this.lineHeight));
  }

  linesPerPage(): number {
    const visible =
      this.surface.clientWidth - this.options.padding.left - this.options.padding.right;
    return Math.max(1, Math.floor(visible / this.lineHeight));
  }

  hitTest(clientX: number, clientY: number): Caret {
    const offset = this.offsetFromPoint(clientX, clientY);
    // 折り返しの境目は、突いた行の側に着ける
    const asEnd = this.caretRect({ offset, preferEnd: true });
    const asStart = this.caretRect({ offset, preferEnd: false });
    if (asEnd.x === asStart.x) return { offset, preferEnd: true };
    const x = clientX - this.surface.getBoundingClientRect().x;
    return { offset, preferEnd: Math.abs(x - asEnd.x) <= Math.abs(x - asStart.x) };
  }

  /** canvas 版と揃えて、surface を原点にした座標を返す (送りぶんは入っている) */
  caretRect(caret: Caret): CaretRect {
    const em = this.options.font.size;
    const surface = this.surface.getBoundingClientRect();
    const box = this.caretBox(caret);
    if (!box) {
      // 本文が空。1 行目の頭に置く
      const { padding } = this.options;
      return {
        x: surface.width - padding.right - this.lineHeight / 2 + this.scroll,
        y: padding.top,
        size: em,
      };
    }
    return {
      x: box.rect.x + box.rect.width / 2 - surface.x,
      y: (box.useEnd ? box.rect.bottom : box.rect.top) - surface.y,
      size: em,
    };
  }

  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal } {
    const rect = this.caretRect(caret);
    const distance = goal ?? rect.y;
    const surface = this.surface.getBoundingClientRect();
    const layer = this.layer.getBoundingClientRect();
    // 縦書きでは direction 1 が次の行 = 左
    const x = surface.x + rect.x - direction * this.lineHeight;

    if (x < layer.x || x > layer.right) {
      const offset = direction === 1 ? this.textLength : 0;
      return { caret: { offset, preferEnd: direction === 1 }, goal: distance };
    }
    return { caret: this.hitTest(x, surface.y + distance), goal: distance };
  }

  lineEdge(caret: Caret, edge: "start" | "end"): Caret {
    const rect = this.caretRect(caret);
    const surface = this.surface.getBoundingClientRect();
    const layer = this.layer.getBoundingClientRect();
    const y = edge === "start" ? layer.y + 1 : layer.bottom - 1;
    const hit = this.hitTest(surface.x + rect.x, y);
    return { offset: hit.offset, preferEnd: edge === "end" };
  }

  get scrollOffset(): number {
    return this.scroll;
  }

  set scrollOffset(value: number) {
    this.scroll = this.clampScroll(value);
    this.layer.style.transform = `translateX(${this.scroll}px)`;
  }

  ensureVisible(caret: Caret): void {
    const width = this.surface.clientWidth;
    if (width === 0) return;
    const { padding } = this.options;
    // caretRect は送りぶんを含んでいるので、はみ出した差だけ足し引きする
    const right = this.caretRect(caret).x + this.lineHeight / 2;
    const left = right - this.lineHeight;

    if (left < padding.left) this.scrollOffset = this.scroll + (padding.left - left);
    else if (right > width - padding.right) {
      this.scrollOffset = this.scroll - (right - (width - padding.right));
    }
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

  private get lineHeight(): number {
    return this.options.font.size * this.options.font.lineHeight;
  }

  private applyStyles(): void {
    const { font, padding, theme, kinsoku } = this.options;
    const common = {
      position: "absolute",
      top: "0",
      right: "0",
      writingMode: "vertical-rl",
      whiteSpace: "pre-wrap",
      wordBreak: "normal",
      overflowWrap: "normal",
      // 禁則をブラウザに任せる。強弱の 2 段しか選べない
      lineBreak: kinsoku ? "strict" : "loose",
      font: `${font.weight} ${font.size}px/${font.lineHeight} ${font.family}`,
      // 選択は自前で描くので、ブラウザの選択は出させない
      userSelect: "none",
      WebkitUserSelect: "none",
    } as Partial<CSSStyleDeclaration>;

    Object.assign(this.layer.style, {
      top: `${padding.top}px`,
      right: `${padding.right}px`,
      transform: `translateX(${this.scroll}px)`,
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.content.style, common, {
      position: "relative",
      zIndex: "1",
      color: theme.text,
    } satisfies Partial<CSSStyleDeclaration>);
    Object.assign(this.placeholder.style, common, {
      zIndex: "1",
      color: theme.placeholder,
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    if (theme.background !== "transparent") this.surface.style.background = theme.background;
  }

  /** 変換中は文節ごとに span を割って、下線をブラウザに引かせる */
  private writeContent(text: string, state: ViewState): void {
    const doc = this.container.ownerDocument;
    const composition = state.composition;
    this.content.textContent = "";
    this.nodes = [];

    const push = (slice: string, start: number, parent: HTMLElement) => {
      if (!slice) return;
      const node = doc.createTextNode(slice);
      parent.appendChild(node);
      this.nodes.push({ node, start });
    };

    if (!composition) {
      push(text, 0, this.content);
      return;
    }

    const { start, end, activeStart, activeEnd } = composition;
    push(text.slice(0, start), 0, this.content);
    for (const [from, to, active] of [
      [start, activeStart, false],
      [activeStart, activeEnd, true],
      [activeEnd, end, false],
    ] as const) {
      if (from >= to) continue;
      const span = doc.createElement("span");
      span.style.textDecoration = "underline";
      span.style.textDecorationThickness = active ? "2px" : "1px";
      span.style.textDecorationColor = active
        ? this.options.theme.compositionActive
        : this.options.theme.composition;
      this.content.appendChild(span);
      push(text.slice(from, to), from, span);
    }
    push(text.slice(end), end, this.content);
  }

  /** 本文の長さ (末尾の番人を除く) */
  private get textLength(): number {
    return this.rendered.length - sentinelLength(this.rendered);
  }

  /**
   * キャレットが乗る字の矩形 (クライアント座標)。
   * 直前の字の終端 (前の行の末尾) か、直後の字の先頭 (次の行の頭) かを preferEnd で選ぶ。
   */
  private caretBox(caret: Caret): { rect: DOMRect; useEnd: boolean } | null {
    const useEnd = caret.preferEnd ? caret.offset > 0 : caret.offset >= this.rendered.length;
    if (useEnd) {
      const rect = this.charRect(caret.offset - 1);
      if (rect) return { rect, useEnd: true };
    }
    const after = this.charRect(caret.offset);
    if (after) return { rect: after, useEnd: false };
    const before = this.charRect(caret.offset - 1);
    return before ? { rect: before, useEnd: true } : null;
  }

  /** offset の 1 文字が占める矩形 (クライアント座標) */
  private charRect(offset: number): DOMRect | null {
    if (offset < 0 || offset >= this.rendered.length) return null;
    const range = this.rangeFor(offset, offset + 1);
    if (!range) return null;
    const rects = range.getClientRects();
    return rects.length > 0 ? rects[0] : null;
  }

  private rangeFor(from: number, to: number): Range | null {
    const start = this.locate(from);
    const end = this.locate(to);
    if (!start || !end) return null;
    const range = this.container.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  }

  private locate(offset: number): { node: Text; offset: number } | null {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const entry = this.nodes[i];
      if (offset >= entry.start && offset <= entry.start + entry.node.length) {
        return { node: entry.node, offset: offset - entry.start };
      }
    }
    return null;
  }

  private offsetFromPoint(clientX: number, clientY: number): number {
    const doc = this.container.ownerDocument as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    let node: Node | null = null;
    let offset = 0;
    if (doc.caretPositionFromPoint) {
      const position = doc.caretPositionFromPoint(clientX, clientY);
      if (position) {
        node = position.offsetNode;
        offset = position.offset;
      }
    } else if (doc.caretRangeFromPoint) {
      // Safari にはこちらしかない
      const range = doc.caretRangeFromPoint(clientX, clientY);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }

    const limit = this.textLength;
    if (!node) return limit;
    for (const entry of this.nodes) {
      if (entry.node === node) return Math.min(entry.start + offset, limit);
    }
    return limit;
  }

  private maxScroll(): number {
    const total = this.content.getBoundingClientRect().width;
    const visible =
      this.surface.clientWidth - this.options.padding.left - this.options.padding.right;
    return Math.max(0, total - visible);
  }

  private clampScroll(value: number): number {
    return value < 0 ? 0 : Math.min(value, this.maxScroll());
  }

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
      this.syncMetrics();
      this.schedule();
    });
    this.resizeObserver.observe(this.container);
  }

  private schedule(): void {
    if (this.destroyed || this.frame) return;
    const view = this.container.ownerDocument.defaultView;
    if (!view) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = 0;
      this.paintOverlay();
    });
  }

  /** 選択とキャレットだけを描き直す */
  private paintOverlay(): void {
    const state = this.state;
    if (this.destroyed || !state) return;
    const layer = this.layer.getBoundingClientRect();
    const doc = this.container.ownerDocument;
    this.selectionLayer.textContent = "";
    this.caretLayer.textContent = "";

    const { selection, caret, caretVisible, focused } = state;
    if (selection.end > selection.start) {
      const range = this.rangeFor(selection.start, selection.end);
      const color = focused ? this.options.theme.selection : this.options.theme.selectionInactive;
      for (const rect of range ? Array.from(range.getClientRects()) : []) {
        const box = doc.createElement("div");
        Object.assign(box.style, {
          position: "absolute",
          background: color,
          // 字の矩形は em ぶんしかない。行の幅まで広げて隣の行と繋げる
          left: `${rect.x - layer.x - (this.lineHeight - rect.width) / 2}px`,
          top: `${rect.y - layer.y}px`,
          width: `${this.lineHeight}px`,
          height: `${rect.height}px`,
        } satisfies Partial<CSSStyleDeclaration>);
        this.selectionLayer.appendChild(box);
      }
    }

    if (caretVisible && focused) {
      const rect = this.caretRect(caret);
      const thickness = Math.max(1, Math.round(this.options.font.size / 14));
      const bar = doc.createElement("div");
      Object.assign(bar.style, {
        position: "absolute",
        background: this.options.theme.caret,
        left: `${rect.x - rect.size / 2}px`,
        top: `${rect.y - thickness / 2}px`,
        width: `${rect.size}px`,
        height: `${thickness}px`,
      } satisfies Partial<CSSStyleDeclaration>);
      this.caretLayer.appendChild(bar);
    }
  }
}

const ZERO_WIDTH_SPACE = "\u200B";

/**
 * 末尾が改行、あるいは空だと最後の行に行ボックスが立たず、
 * キャレットの置き場が無くなる。幅ゼロの字で 1 行ぶん立てる。
 */
function sentinelFor(text: string): string {
  return text.length === 0 || text.endsWith("\n") ? ZERO_WIDTH_SPACE : "";
}

function sentinelLength(rendered: string): number {
  return rendered.endsWith(ZERO_WIDTH_SPACE) ? 1 : 0;
}
