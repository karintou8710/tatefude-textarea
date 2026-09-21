import type { Caret, Goal } from "../../text/caret";
import type { ResolvedOptions } from "../../types";
import type { Backend, CaretRect, Handle, ViewState } from "../backend";
import { CaretBlink } from "../blink";
import { ContainerStyle } from "../container";
import { fontBoxSize } from "../font-box";
import { grabsHandle } from "../handle";
import { type Axis, blockOfCaret } from "./axis";
import * as geometry from "./geometry";
import { Renderer } from "./renderer";
import { DomScroller, type ScrollHost } from "./scroller";
import * as styles from "./styles";

/** 行送りを測るのに読む字数。数行ぶん見えれば足りる */
const PITCH_SAMPLE = 400;

/**
 * レイアウトはブラウザに任せる。字の向き (UAX #50)・縦組み字形・禁則は
 * writing-mode の中で解決されるので、こちらは
 * 「どこに何が落ちたか」を Range API で読み返すだけ。
 *
 * **判断は持たない。**どこにキャレットが立つかは `geometry.ts`、
 * 縦横の入れ替えは `axis.ts`、送りは `scroller.ts`、
 * 要素と CSS は `styles.ts`、重ねる層は `renderer.ts`。
 * ここがやるのは組み立てと、測った答えを配ること。
 */
export class DomBackend implements Backend {
  readonly surface: HTMLElement;

  private els: styles.Elements;
  private options: ResolvedOptions;
  /** CSS から読んだ寸法。レイアウトし直すたびに読み直す */
  private metrics: styles.Metrics;
  private state: ViewState | null = null;
  private blink = new CaretBlink(() => this.schedule());
  private containerStyle: ContainerStyle;
  /** 測った行送り。レイアウトし直すたびに捨てる */
  private pitch: number | null = null;
  /** content に流し込んだテキスト (末尾の番人を含む) */
  private rendered = "";
  /** テキストのオフセットと、それを持つ Text ノードの対応 */
  private nodes: { node: Text; start: number }[] = [];

  private scroller: DomScroller;
  private renderer: Renderer;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private disposers: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    options: ResolvedOptions,
  ) {
    this.options = options;
    // 中身を絶対配置で重ねるので、コンテナに位置の基準を入れてから作る。
    // 寸法を CSS から読むので、クラスも読む前に当てる
    this.containerStyle = new ContainerStyle(container);
    this.containerStyle.setClassName(options.className);

    this.els = styles.createElements(container);
    this.surface = this.els.surface;
    this.metrics = styles.readMetrics(container);
    this.renderer = new Renderer(
      container.ownerDocument,
      this.els.selectionLayer,
      this.els.caretLayer,
      () => this.options,
    );
    this.scroller = new DomScroller(this.scrollHost());
    this.applyStyles();
    this.syncGeometry();
    this.observeResize();
  }

  setOptions(options: ResolvedOptions): void {
    this.options = options;
    this.containerStyle.setClassName(options.className);
    // writingMode や色は metrics に出ないので、同じでも当て直す
    this.metrics = styles.readMetrics(this.container);
    this.applyStyles();
    this.syncGeometry();
  }

  /**
   * 呼び手は「CSS が変わったかもしれない」としか分からないので、空振りが多い。
   * React なら描画のたびに来る。
   *
   * 高いのは applyStyles で、行送りの実測を捨てるから次に測り直しになる。
   * これは metrics に出る値が動いたときだけでいい。
   * レイアウトのほうは line-break のように metrics に出ない指定でも変わるので、
   * 毎回合わせる。読むのは content の矩形 1 つで、行を測り直すのとは桁が違う。
   */
  refresh(): void {
    const next = styles.readMetrics(this.container);
    if (!styles.sameMetrics(this.metrics, next)) {
      this.metrics = next;
      this.applyStyles();
    }
    this.syncGeometry();
  }

  update(state: ViewState): void {
    const text = state.text + geometry.sentinelFor(state.text);
    // 幾何を引く前に要るので、本文だけは同期で流し込む
    if (text !== this.rendered || state.composition !== this.state?.composition) {
      this.writeContent(text, state);
      this.rendered = text;
      styles.syncLayerBreadth(this.els, this.vertical);
      this.syncSpacer();
    }
    this.state = state;
    this.els.placeholder.textContent = state.placeholder ?? "";
    this.els.placeholder.style.display = state.placeholder ? "block" : "none";
    this.schedule();
  }

  get fontSize(): number {
    return this.metrics.size;
  }

  get lineCount(): number {
    const box = this.els.content.getBoundingClientRect();
    return Math.max(1, Math.round((this.vertical ? box.width : box.height) / this.lineHeight));
  }

  linesPerPage(): number {
    return Math.max(1, Math.floor(this.scroller.visibleBreadth() / this.lineHeight));
  }

  hitTest(clientX: number, clientY: number): Caret {
    const offset = this.offsetFromPoint(clientX, clientY);
    return geometry.caretAtPoint(this.axis(), this.readContent(), offset, clientX, clientY);
  }

  /** canvas 版と揃えて、surface を原点にした矩形を返す。送り方向の厚みは持たない */
  hitHandle(clientX: number, clientY: number): Handle | null {
    const state = this.state;
    if (!state) return null;
    const axis = this.axis();
    const x = clientX - axis.surface.x;
    const y = clientY - axis.surface.y;
    for (const [edge, center] of geometry.handlePoints(axis, this.readContent(), state)) {
      if (grabsHandle(center, x, y)) return edge;
    }
    return null;
  }

  caretRect(caret: Caret): CaretRect {
    return geometry.caretRect(this.axis(), this.readContent(), caret);
  }

  selectionRect(start: number, end: number): CaretRect | null {
    if (end <= start) return null;
    const range = this.rangeFor(start, end);
    if (!range) return null;
    const box = range.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    const surface = this.surface.getBoundingClientRect();
    return { x: box.x - surface.x, y: box.y - surface.y, width: box.width, height: box.height };
  }

  moveAcross(caret: Caret, direction: 1 | -1, goal: Goal): { caret: Caret; goal: Goal } {
    const axis = this.axis();
    return geometry.moveAcross(axis, this.readContent(), caret, direction, goal, this.lineCount);
  }

  lineEdge(caret: Caret, edge: "start" | "end"): Caret {
    return geometry.lineEdge(this.axis(), this.readContent(), caret, edge);
  }

  // ---- 送り。中身は DomScroller ----

  /** 送りがレイアウトから引くもの。レイアウトのたびに変わるので、値ではなく読み方を渡す */
  private scrollHost(): ScrollHost {
    return {
      surface: this.surface,
      vertical: () => this.vertical,
      lineHeight: () => this.lineHeight,
      padStart: () => (this.vertical ? this.metrics.padding.left : this.metrics.padding.top),
      padEnd: () => (this.vertical ? this.metrics.padding.right : this.metrics.padding.bottom),
      contentLength: () => {
        const box = this.els.content.getBoundingClientRect();
        return this.vertical ? box.width : box.height;
      },
      blockCenterOf: (caret) => {
        const axis = this.axis();
        return blockOfCaret(axis, geometry.caretRect(axis, this.readContent(), caret));
      },
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
    this.surface.remove();
  }

  // ---- 測って渡す ----

  /**
   * 向きと寸法と原点をひとまとめにする。**1 操作につき 1 回だけ作る。**
   * 中の矩形は getBoundingClientRect なので、引くたびに作るとレイアウトを
   * 何度も確定させることになる
   */
  private axis(): Axis {
    return {
      vertical: this.vertical,
      lineHeight: this.lineHeight,
      fontBox: fontBoxSize(this.container.ownerDocument, this.metrics.css, this.metrics.size),
      layer: this.els.layer.getBoundingClientRect(),
      surface: this.surface.getBoundingClientRect(),
    };
  }

  /** 位置引きへ渡す読み口。書き込む側は writeContent */
  private readContent(): geometry.Content {
    return { rendered: this.rendered, charRect: (offset) => this.charRect(offset) };
  }

  private get vertical(): boolean {
    return this.options.writingMode === "vertical-rl";
  }

  /**
   * 行送り。CSS の line-height をそのまま信じない。
   * Safari は端数を整数に丸める (17px × 1.8 = 30.6 → 30) ので、
   * 決め打つと行番号に比例してキャレットが本文からずれていく。
   * 実際にレイアウトされた行の間隔を測って、それを使う。
   */
  private get lineHeight(): number {
    if (this.pitch === null) this.pitch = this.measurePitch();
    return this.pitch;
  }

  /** 行を 2 本ぶん測って geometry に渡す。長い本文で全行ぶんの矩形を作らない */
  private measurePitch(): number {
    const fallback = this.metrics.lineHeight;
    const node = this.nodes[0]?.node;
    if (!node) return fallback;

    const range = this.container.ownerDocument.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(node.length, PITCH_SAMPLE));
    return geometry.pitchOf(this.vertical, Array.from(range.getClientRects()), fallback);
  }

  // ---- レイアウト。当てるのは styles.ts ----

  /**
   * 寸法 → レイアウト → 送れる上限 の順に揃える。
   * 上限はレイアウトの結果から決まるので、測って確定させたあとでないと古い値のままになる。
   * そのあとに送ると、送りがその古い上限で丸められる
   */
  private syncGeometry(): void {
    styles.syncMetrics(this.els, this.metrics, this.vertical);
    // getBoundingClientRect がレイアウトを確定させる
    styles.syncLayerBreadth(this.els, this.vertical);
    this.syncSpacer();
  }

  private syncSpacer(): void {
    styles.syncSpacer(this.els, this.vertical, this.scroller.maxScroll());
  }

  private applyStyles(): void {
    // 字の大きさやレイアウトが変われば行送りも変わる。測り直す
    this.pitch = null;
    styles.applyStyles(this.els, this.options, this.metrics);
  }

  /** 変換中は文節ごとに span を割って、下線をブラウザに引かせる */
  private writeContent(text: string, state: ViewState): void {
    const doc = this.container.ownerDocument;
    const composition = state.composition;
    const content = this.els.content;
    content.textContent = "";
    this.nodes = [];
    this.pitch = null;

    const push = (slice: string, start: number, parent: HTMLElement) => {
      if (!slice) return;
      const node = doc.createTextNode(slice);
      parent.appendChild(node);
      this.nodes.push({ node, start });
    };

    if (!composition) {
      push(text, 0, content);
      return;
    }

    const { start, end, activeStart, activeEnd } = composition;
    push(text.slice(0, start), 0, content);
    for (const [from, to, active] of [
      [start, activeStart, false],
      [activeStart, activeEnd, true],
      [activeEnd, end, false],
    ] as const) {
      if (from >= to) continue;
      const span = doc.createElement("span");
      Object.assign(span.style, {
        textDecoration: "underline",
        textDecorationThickness: active ? "2px" : "1px",
        textDecorationColor: active
          ? this.options.theme.compositionActive
          : this.options.theme.composition,
      } satisfies Partial<CSSStyleDeclaration>);
      content.appendChild(span);
      push(text.slice(from, to), from, span);
    }
    push(text.slice(end), end, content);
  }

  // ---- 位置引き。DOM から読むところだけ ----

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

    const limit = geometry.textLength(this.readContent());
    // 突いた場所が本文に当たらないことがある (余白・重なり・エンジン差)。
    // 文末へ飛ばすとキャレットが画面外へ出て、iOS ではキーボードが開いて即閉じる。
    // 当たらなければ動かさない
    const fallback = this.state?.caret.offset ?? 0;
    if (!node) return Math.min(fallback, limit);
    for (const entry of this.nodes) {
      if (entry.node === node) return Math.min(entry.start + offset, limit);
    }
    return Math.min(fallback, limit);
  }

  // ---- 描き直し ----

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

  private schedule(): void {
    if (this.destroyed || this.frame) return;
    const view = this.container.ownerDocument.defaultView;
    if (!view) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = 0;
      this.paintOverlay();
    });
  }

  /** 選択とキャレットだけを描き直す。置くのは Renderer */
  private paintOverlay(): void {
    const state = this.state;
    if (this.destroyed || !state) return;
    const axis = this.axis();
    const content = this.readContent();
    const { selection, caret, caretVisible, focused } = state;
    const range =
      selection.end > selection.start ? this.rangeFor(selection.start, selection.end) : null;

    this.renderer.paint({
      axis,
      focused,
      selection: range ? Array.from(range.getClientRects()) : [],
      // 点滅で「いま出す番か」を掛けるのは描く側の都合。状態には出さない
      caret:
        caretVisible && focused && this.blink.on ? geometry.caretRect(axis, content, caret) : null,
      handles: geometry.handlePoints(axis, content, state),
    });
  }
}
