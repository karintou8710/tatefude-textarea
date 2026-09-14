import type { Backend, CaretRect, ViewState } from "../backend";
import type { Caret, Goal } from "../model/movement";
import type { ResolvedOptions } from "../types";

/**
 * 組むのはブラウザに任せる。字の向き (UAX #50)・縦組み字形・禁則は
 * writing-mode の中で解決されるので、こちらは
 * 「どこに何が落ちたか」を Range API で読み返すだけ。
 *
 * 座標は inline (字の並ぶ向き) と block (行の重なる向き) で持ち、
 * 物理の x/y へ直すのはこのファイルの中だけで済ませる。
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
      touchAction: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    // 本文。block 始端 (縦書きなら右上、横書きなら左上) を起点に伸びる
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
      this.syncLayerBreadth();
    }
    this.state = state;
    this.placeholder.textContent = state.placeholder ?? "";
    this.placeholder.style.display = state.placeholder ? "block" : "none";
    this.schedule();
  }

  get lineCount(): number {
    const box = this.content.getBoundingClientRect();
    return Math.max(1, Math.round((this.vertical ? box.width : box.height) / this.lineHeight));
  }

  linesPerPage(): number {
    return Math.max(1, Math.floor(this.visibleBreadth() / this.lineHeight));
  }

  hitTest(clientX: number, clientY: number): Caret {
    const offset = this.offsetFromPoint(clientX, clientY);
    // 折り返しの境目は、突いた行の側に着ける
    const asEnd = this.blockOfCaret(this.caretRect({ offset, preferEnd: true }));
    const asStart = this.blockOfCaret(this.caretRect({ offset, preferEnd: false }));
    if (asEnd === asStart) return { offset, preferEnd: true };

    const surface = this.surface.getBoundingClientRect();
    const at = this.vertical ? clientX - surface.x : clientY - surface.y;
    return { offset, preferEnd: Math.abs(at - asEnd) <= Math.abs(at - asStart) };
  }

  /** canvas 版と揃えて、surface を原点にした厚みゼロの矩形を返す */
  caretRect(caret: Caret): CaretRect {
    const em = this.options.font.size;
    const surface = this.surface.getBoundingClientRect();
    const layer = this.layer.getBoundingClientRect();
    const box = this.caretBox(caret);

    const line = box ? this.lineOfRect(box.rect, layer) : 0;
    const inline = box
      ? box.useEnd
        ? this.inlineEndOf(box.rect, layer)
        : this.inlineStartOf(box.rect, layer)
      : 0;
    const at = this.toClient((line + 0.5) * this.lineHeight, inline, layer);

    return this.vertical
      ? { x: at.x - em / 2 - surface.x, y: at.y - surface.y, width: em, height: 0 }
      : { x: at.x - surface.x, y: at.y - em / 2 - surface.y, width: 0, height: em };
  }

  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal } {
    const rect = this.caretRect(caret);
    const distance = goal ?? this.inlineOfCaret(rect);
    const layer = this.layer.getBoundingClientRect();

    const target = this.lineAt(this.blockOfCaretInLayer(rect, layer)) + direction;
    if (target < 0) return { caret: { offset: 0, preferEnd: false }, goal: distance };
    if (target >= this.lineCount) {
      return { caret: { offset: this.textLength, preferEnd: true }, goal: distance };
    }
    return {
      caret: this.caretInLine(target, this.inlineInLayer(distance, layer), layer),
      goal: distance,
    };
  }

  lineEdge(caret: Caret, edge: "start" | "end"): Caret {
    const layer = this.layer.getBoundingClientRect();
    const line = this.lineAt(this.blockOfCaretInLayer(this.caretRect(caret), layer));
    const inline = edge === "start" ? 0 : this.layerLength(layer);
    return { ...this.caretInLine(line, inline, layer), preferEnd: edge === "end" };
  }

  get scrollOffset(): number {
    return this.scroll;
  }

  set scrollOffset(value: number) {
    this.scroll = this.clampScroll(value);
    // 縦書きは左へ読み進むので中身を右へ、横書きは下へ進むので中身を上へ送る
    this.layer.style.transform = this.vertical
      ? `translateX(${this.scroll}px)`
      : `translateY(${-this.scroll}px)`;
  }

  ensureVisible(caret: Caret): void {
    const visible = this.vertical ? this.surface.clientWidth : this.surface.clientHeight;
    if (visible === 0) return;
    const { padding } = this.options;
    const rect = this.caretRect(caret);
    // caretRect は送りぶんを含んでいるので、はみ出した差だけ足し引きする
    const center = this.vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
    const near = center - this.lineHeight / 2;
    const far = center + this.lineHeight / 2;

    if (this.vertical) {
      if (near < padding.left) this.scrollOffset = this.scroll + (padding.left - near);
      else if (far > visible - padding.right) {
        this.scrollOffset = this.scroll - (far - (visible - padding.right));
      }
      return;
    }
    if (near < padding.top) this.scrollOffset = this.scroll - (padding.top - near);
    else if (far > visible - padding.bottom) {
      this.scrollOffset = this.scroll + (far - (visible - padding.bottom));
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

  // ---- 軸 ----

  private get vertical(): boolean {
    return this.options.writingMode === "vertical-rl";
  }

  private get lineHeight(): number {
    return this.options.font.size * this.options.font.lineHeight;
  }

  /** layer の block 始端からの距離 → クライアント座標 */
  private toClient(block: number, inline: number, layer: DOMRect): { x: number; y: number } {
    return this.vertical
      ? { x: layer.right - block, y: layer.top + inline }
      : { x: layer.left + inline, y: layer.top + block };
  }

  private lineAt(block: number): number {
    return Math.max(0, Math.floor(block / this.lineHeight));
  }

  private lineOfRect(rect: DOMRect, layer: DOMRect): number {
    const center = this.vertical
      ? layer.right - (rect.x + rect.width / 2)
      : rect.y + rect.height / 2 - layer.top;
    return this.lineAt(center);
  }

  private inlineStartOf(rect: DOMRect, layer: DOMRect): number {
    return this.vertical ? rect.top - layer.top : rect.left - layer.left;
  }

  private inlineEndOf(rect: DOMRect, layer: DOMRect): number {
    return this.vertical ? rect.bottom - layer.top : rect.right - layer.left;
  }

  private inlineSizeOf(rect: DOMRect): number {
    return this.vertical ? rect.height : rect.width;
  }

  private layerLength(layer: DOMRect): number {
    return this.vertical ? layer.height : layer.width;
  }

  /** surface 基準のキャレット矩形から block 方向の位置を取り出す */
  private blockOfCaret(rect: CaretRect): number {
    return this.vertical ? rect.x : rect.y;
  }

  private inlineOfCaret(rect: CaretRect): number {
    return this.vertical ? rect.y : rect.x;
  }

  private blockOfCaretInLayer(rect: CaretRect, layer: DOMRect): number {
    const surface = this.surface.getBoundingClientRect();
    return this.vertical
      ? layer.right - (surface.x + rect.x + rect.width / 2)
      : surface.y + rect.y + rect.height / 2 - layer.top;
  }

  /** surface 基準の inline 位置 → layer 基準 */
  private inlineInLayer(distance: number, layer: DOMRect): number {
    const surface = this.surface.getBoundingClientRect();
    return this.vertical ? surface.y + distance - layer.top : surface.x + distance - layer.left;
  }

  private visibleBreadth(): number {
    const { padding } = this.options;
    return this.vertical
      ? this.surface.clientWidth - padding.left - padding.right
      : this.surface.clientHeight - padding.top - padding.bottom;
  }

  // ---- 組み ----

  /**
   * 行の長さを px で入れる。% のままだと block 方向を決める段階で
   * inline 方向が未定になり、縦書き (直交フロー) の幅が決まらない。
   */
  private syncMetrics(): void {
    const { padding } = this.options;
    const length = Math.max(
      0,
      this.vertical
        ? this.surface.clientHeight - padding.top - padding.bottom
        : this.surface.clientWidth - padding.left - padding.right,
    );
    const key = this.vertical ? "height" : "width";
    const other = this.vertical ? "width" : "height";
    for (const el of [this.layer, this.content, this.placeholder]) {
      el.style[key] = `${length}px`;
      if (el !== this.layer) el.style[other] = "";
    }
    this.syncLayerBreadth();
  }

  /**
   * layer の block 方向の大きさは content に合わせる。
   * auto (shrink-to-fit) も max-content も、縦書きの子は直交フローなので
   * Chrome が中身の変更で intrinsic を計算し直さず、桁違いの値のまま残る。
   * content 自身は行の長さだけで決まるので、測って入れる。
   */
  private syncLayerBreadth(): void {
    const box = this.content.getBoundingClientRect();
    if (this.vertical) this.layer.style.width = `${box.width}px`;
    else this.layer.style.height = `${box.height}px`;
  }

  private applyStyles(): void {
    const { font, padding, theme, kinsoku, writingMode } = this.options;
    const vertical = this.vertical;

    // 縦組みの I ビームは横向き。text は横書き用
    this.surface.style.cursor = vertical ? "vertical-text" : "text";

    const common = {
      position: "absolute",
      top: "0",
      left: vertical ? "auto" : "0",
      right: vertical ? "0" : "auto",
      writingMode,
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
      left: vertical ? "auto" : `${padding.left}px`,
      right: vertical ? `${padding.right}px` : "auto",
    } satisfies Partial<CSSStyleDeclaration>);
    this.scrollOffset = this.scroll;

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

  // ---- 位置引き ----

  /** 行と送り位置で順に並ぶ鍵。offset が増えれば単調に増える */
  private sortKey(line: number, inline: number, layer: DOMRect): number {
    return line * (this.layerLength(layer) + 1) + inline;
  }

  /**
   * 指定の行の、指定の送り位置にいちばん近いキャレット。
   *
   * caretPositionFromPoint は描かれている場所しか当たらず、
   * overflow: hidden で隠れた行に移れない。offset の並びが
   * (行, 送り) の順と一致することを使って二分探索する。
   */
  private caretInLine(line: number, inline: number, layer: DOMRect): Caret {
    const length = this.textLength;
    const target = this.sortKey(line, inline, layer);

    // 目標より手前で終わる字を読み飛ばす
    let lo = 0;
    let hi = length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const rect = this.charRect(mid);
      const key = rect
        ? this.sortKey(this.lineOfRect(rect, layer), this.inlineEndOf(rect, layer), layer)
        : Number.POSITIVE_INFINITY;
      if (key < target) lo = mid + 1;
      else hi = mid;
    }

    const landed = this.charRect(lo);
    // 改行はその行の持ち物。次の行まで行き過ぎていたら手前に戻す
    if (!landed || this.lineOfRect(landed, layer) !== line) {
      const end = this.rendered[lo - 1] === "\n" ? lo - 1 : lo;
      return { offset: Math.min(end, length), preferEnd: true };
    }
    // 改行と末尾の番人は矩形が潰れている。字として跨がない
    if (this.rendered[lo] === "\n" || lo >= length) {
      return { offset: Math.min(lo, length), preferEnd: true };
    }

    // 字の後ろ半分を指していたら次の位置へ。ちょうど中点は手前
    const size = this.inlineSizeOf(landed);
    const middle = this.inlineStartOf(landed, layer) + size / 2;
    const after = size > 0 && inline > middle;
    const offset = Math.min(after ? lo + 1 : lo, length);
    const next = this.charRect(offset);
    const atEnd = !next || this.rendered[offset] === "\n" || this.lineOfRect(next, layer) !== line;
    return { offset, preferEnd: atEnd };
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
    // 改行の直後は必ず次の行の頭。折り返しと違って、前の行の末尾に着ける余地がない
    const afterBreak = this.rendered[caret.offset - 1] === "\n";
    const useEnd = afterBreak
      ? false
      : caret.preferEnd
        ? caret.offset > 0
        : caret.offset >= this.rendered.length;
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
      // Safari 18.2 より前にはこちらしかない
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

  // ---- 送り ----

  private maxScroll(): number {
    const box = this.content.getBoundingClientRect();
    const total = this.vertical ? box.width : box.height;
    return Math.max(0, total - this.visibleBreadth());
  }

  private clampScroll(value: number): number {
    return value < 0 ? 0 : Math.min(value, this.maxScroll());
  }

  private bindWheel(): void {
    const listener = (event: WheelEvent) => {
      if (this.maxScroll() <= 0) return;
      event.preventDefault();
      // 縦書きは左へ読み進む。ホイール下と左スワイプで先へ送る
      this.scrollOffset = this.vertical
        ? this.scroll + event.deltaY - event.deltaX
        : this.scroll + event.deltaY;
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
        // 字の矩形は em ぶんしかない。行の幅まで広げて隣の行と繋げる
        const grow = (size: number) => (this.lineHeight - size) / 2;
        Object.assign(box.style, {
          position: "absolute",
          background: color,
          left: `${rect.x - layer.x - (this.vertical ? grow(rect.width) : 0)}px`,
          top: `${rect.y - layer.y - (this.vertical ? 0 : grow(rect.height))}px`,
          width: `${this.vertical ? this.lineHeight : rect.width}px`,
          height: `${this.vertical ? rect.height : this.lineHeight}px`,
        } satisfies Partial<CSSStyleDeclaration>);
        this.selectionLayer.appendChild(box);
      }
    }

    if (caretVisible && focused) {
      // caretRect は surface 基準。矩形を置くのは layer の中なので原点を移す
      const surface = this.surface.getBoundingClientRect();
      const rect = this.caretRect(caret);
      const thickness = Math.max(1, Math.round(this.options.font.size / 14));
      const bar = doc.createElement("div");
      bar.dataset.caret = "";
      Object.assign(bar.style, {
        position: "absolute",
        background: this.options.theme.caret,
        left: `${surface.x + rect.x - layer.x - (this.vertical ? 0 : thickness / 2)}px`,
        top: `${surface.y + rect.y - layer.y - (this.vertical ? thickness / 2 : 0)}px`,
        width: `${this.vertical ? rect.width : thickness}px`,
        height: `${this.vertical ? thickness : rect.height}px`,
      } satisfies Partial<CSSStyleDeclaration>);
      this.caretLayer.appendChild(bar);
    }
  }
}

const ZERO_WIDTH_SPACE = "​";

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
