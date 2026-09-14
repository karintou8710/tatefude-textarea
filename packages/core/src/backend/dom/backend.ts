import type { Caret, Goal } from "../../model/movement";
import type { ResolvedOptions } from "../../types";
import type { Backend, CaretRect, Handle, ViewState } from "../backend";
import { fontBoxSize } from "../font-box";
import { grabsHandle, HANDLE_RADIUS, type HandlePoint, handleCenter } from "../handle";
import * as axis from "./axis";
import { DomScroller, type ScrollHost } from "./scroller";

/** ネイティブの textarea と同じで、字の大きさには比例しない (CSS px) */
const CARET_WIDTH = 1;

/** 行送りを測るのに読む字数。数行ぶん見えれば足りる */
const PITCH_SAMPLE = 400;

/** container の計算スタイルから読んだ、組みに要る寸法 */
interface Metrics {
  /** font の短縮形。fontBoxSize に渡す */
  css: string;
  size: number;
  /** 行送り (px)。measurePitch が測れなかったときの代用 */
  lineHeight: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

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
  /** スクロールできる量をブラウザに持たせるための場所取り */
  private spacer: HTMLElement;
  private content: HTMLElement;
  private placeholder: HTMLElement;
  private selectionLayer: HTMLElement;
  private caretLayer: HTMLElement;

  private options: ResolvedOptions;
  /** CSS から読んだ寸法。組み直すたびに読み直す */
  private metrics: Metrics;
  private state: ViewState | null = null;
  /** 測った行送り。組み直すたびに捨てる */
  private pitch: number | null = null;
  /** content に流し込んだテキスト (末尾の番人を含む) */
  private rendered = "";
  /** テキストのオフセットと、それを持つ Text ノードの対応 */
  private nodes: { node: Text; start: number }[] = [];

  private scroller: DomScroller;
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

    // スクロールコンテナ。送り方向だけ開けて、慣性もラバーバンドもブラウザに任せる。
    // 向きに依る指定は writingMode ごと applyStyles で入れる
    this.surface = doc.createElement("div");
    Object.assign(this.surface.style, {
      position: "absolute",
      inset: "0",
    } satisfies Partial<CSSStyleDeclaration>);

    // 本文。block 始端 (縦書きなら右上、横書きなら左上) を起点に伸びる。
    // 絶対配置でも containing block である surface のスクロール領域を広げる
    this.layer = doc.createElement("div");
    Object.assign(this.layer.style, {
      position: "absolute",
    } satisfies Partial<CSSStyleDeclaration>);

    // 絶対配置のはみ出しをスクロール領域として当てにすると、器が変わったときの
    // 追従がエンジン任せになる。送れる量は自分で置く
    this.spacer = doc.createElement("div");

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
    this.surface.append(this.spacer, this.layer);
    container.appendChild(this.surface);

    this.metrics = readMetrics(container);
    this.scroller = new DomScroller(this.scrollHost());
    this.applyStyles();
    this.syncGeometry();
    this.observeResize();
  }

  setOptions(options: ResolvedOptions): void {
    this.options = options;
    // writingMode や色は metrics に出ないので、同じでも当て直す
    this.metrics = readMetrics(this.container);
    this.applyStyles();
    this.syncGeometry();
  }

  /**
   * 呼び手は「CSS が変わったかもしれない」としか分からないので、空振りが多い。
   * React なら描画のたびに来る。
   *
   * 高いのは applyStyles で、行送りの実測を捨てるから次に測り直しになる。
   * これは metrics に出る値が動いたときだけでいい。
   * 組み上がりのほうは line-break のように metrics に出ない指定でも変わるので、
   * 毎回合わせる。読むのは content の矩形 1 つで、行を測り直すのとは桁が違う。
   */
  refresh(): void {
    const next = readMetrics(this.container);
    if (!sameMetrics(this.metrics, next)) {
      this.metrics = next;
      this.applyStyles();
    }
    this.syncGeometry();
  }

  update(state: ViewState): void {
    const text = state.text + sentinelFor(state.text);
    // 幾何を引く前に要るので、本文だけは同期で流し込む
    if (text !== this.rendered || state.composition !== this.state?.composition) {
      this.writeContent(text, state);
      this.rendered = text;
      this.syncLayerBreadth();
      this.syncSpacer();
    }
    this.state = state;
    this.placeholder.textContent = state.placeholder ?? "";
    this.placeholder.style.display = state.placeholder ? "block" : "none";
    this.schedule();
  }

  get fontSize(): number {
    return this.metrics.size;
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

  /** canvas 版と揃えて、surface を原点にした矩形を返す。送り方向の厚みは持たない */
  hitHandle(clientX: number, clientY: number): Handle | null {
    const surface = this.surface.getBoundingClientRect();
    const x = clientX - surface.x;
    const y = clientY - surface.y;
    for (const [edge, center] of this.handlePoints()) {
      if (grabsHandle(center, x, y)) return edge;
    }
    return null;
  }

  /** つまみの中心 (surface 基準)。選択の両端に 1 つずつ */
  private handlePoints(): [edge: Handle, center: HandlePoint][] {
    const state = this.state;
    if (!state?.handles || !state.focused) return [];
    const { selection } = state;
    // キャレットだけのときは出さない。掴めるのは選択の端だけ
    if (selection.end === selection.start) return [];
    const start = this.caretRect({ offset: selection.start, preferEnd: false });
    const end = this.caretRect({ offset: selection.end, preferEnd: true });
    return [
      ["start", handleCenter(start, this.vertical, "start")],
      ["end", handleCenter(end, this.vertical, "end")],
    ];
  }

  caretRect(caret: Caret): CaretRect {
    // 行を横切る向きの長さは字が入っている箱ぶん。行送りは含めない
    const breadth = fontBoxSize(this.container.ownerDocument, this.metrics.css, this.metrics.size);
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
      ? { x: at.x - breadth / 2 - surface.x, y: at.y - surface.y, width: breadth, height: 0 }
      : { x: at.x - surface.x, y: at.y - breadth / 2 - surface.y, width: 0, height: breadth };
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
    const landed = this.caretInLine(line, inline, layer);
    if (edge === "start") return { ...landed, preferEnd: false };
    return { offset: this.afterHangingSpace(landed.offset, line, layer), preferEnd: true };
  }

  /**
   * pre-wrap では、折り返しを起こした空白が行末にぶら下がる。
   * 内容幅の外に置かれるので二分探索では拾えない。行末はその後ろ。
   */
  private afterHangingSpace(offset: number, line: number, layer: DOMRect): number {
    const text = this.rendered[offset];
    if (text !== " " && text !== "\t") return offset;
    const rect = this.charRect(offset);
    if (!rect || this.lineOfRect(rect, layer) !== line) return offset;
    return Math.min(offset + 1, this.textLength);
  }

  // ---- 送り。中身は DomScroller ----

  /** 送りが組みから引くもの。組み直しのたびに変わるので、値ではなく読み方を渡す */
  private scrollHost(): ScrollHost {
    return {
      surface: this.surface,
      vertical: () => this.vertical,
      lineHeight: () => this.lineHeight,
      padStart: () => (this.vertical ? this.metrics.padding.left : this.metrics.padding.top),
      padEnd: () => (this.vertical ? this.metrics.padding.right : this.metrics.padding.bottom),
      contentLength: () => {
        const box = this.content.getBoundingClientRect();
        return this.vertical ? box.width : box.height;
      },
      caretRect: (caret) => this.caretRect(caret),
      state: () => this.state,
    };
  }

  get scrollOffset(): number {
    return this.scroller.scrollOffset;
  }

  set scrollOffset(value: number) {
    this.scroller.scrollOffset = value;
  }

  ensureVisible(caret: Caret): void {
    this.scroller.ensureVisible(caret);
  }

  anchorCaret(): void {
    this.scroller.anchorCaret();
  }

  forgetAnchor(): void {
    this.scroller.forgetAnchor();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.scroller.destroy();
    this.resizeObserver?.disconnect();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.surface.remove();
  }

  // ---- 軸 ----

  private get vertical(): boolean {
    return this.options.writingMode === "vertical-rl";
  }

  /**
   * 行送り。CSS の line-height をそのまま信じない。
   * Safari は端数を整数に丸める (17px × 1.8 = 30.6 → 30) ので、
   * 決め打つと行番号に比例してキャレットが本文からずれていく。
   * 実際に組まれた行の間隔を測って、それを使う。
   */
  private get lineHeight(): number {
    if (this.pitch === null) this.pitch = this.measurePitch();
    return this.pitch;
  }

  /** 組まれた行の間隔。測れなければ CSS の指定で代用する */
  private measurePitch(): number {
    const fallback = this.metrics.lineHeight;
    const node = this.nodes[0]?.node;
    if (!node) return fallback;

    // 行が 2 本見つかれば足りる。長い本文で全行ぶんの矩形を作らない
    const range = this.container.ownerDocument.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(node.length, PITCH_SAMPLE));
    const rects = Array.from(range.getClientRects());
    if (rects.length < 2) return fallback;

    // 同じ行に複数の断片が出ることがある。1/4px に丸めて行の位置だけを拾う
    const blocks = rects.map((rect) =>
      Math.round((this.vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2) * 4),
    );
    const sorted = [...new Set(blocks)].sort((a, b) => a - b);

    // 空行は行 2 つぶんの隙間を作る。いちばん狭い隙間が行送り
    let pitch = Number.POSITIVE_INFINITY;
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i] - sorted[i - 1]) / 4;
      if (gap > 1 && gap < pitch) pitch = gap;
    }
    return Number.isFinite(pitch) ? pitch : fallback;
  }

  /** layer の block 始端からの距離 → クライアント座標 */
  // 計算そのものは axis.ts。ここは向きと、測った行送りを差すだけ

  private toClient(block: number, inline: number, layer: DOMRect) {
    return axis.toClient(this.vertical, block, inline, layer);
  }

  private lineAt(block: number): number {
    return axis.lineAt(this.lineHeight, block);
  }

  private lineOfRect(rect: DOMRect, layer: DOMRect): number {
    return this.lineAt(axis.blockOfRectInLayer(this.vertical, rect, layer));
  }

  private inlineStartOf(rect: DOMRect, layer: DOMRect): number {
    return axis.inlineStartOf(this.vertical, rect, layer);
  }

  private inlineEndOf(rect: DOMRect, layer: DOMRect): number {
    return axis.inlineEndOf(this.vertical, rect, layer);
  }

  private inlineSizeOf(rect: DOMRect): number {
    return axis.inlineSizeOf(this.vertical, rect);
  }

  private layerLength(layer: DOMRect): number {
    return axis.layerLength(this.vertical, layer);
  }

  private blockOfCaret(rect: CaretRect): number {
    return axis.blockOfCaret(this.vertical, rect);
  }

  private inlineOfCaret(rect: CaretRect): number {
    return axis.inlineOfCaret(this.vertical, rect);
  }

  private blockOfCaretInLayer(rect: CaretRect, layer: DOMRect): number {
    const surface = this.surface.getBoundingClientRect();
    return axis.blockOfCaretInLayer(this.vertical, rect, layer, surface);
  }

  private inlineInLayer(distance: number, layer: DOMRect): number {
    const surface = this.surface.getBoundingClientRect();
    return axis.inlineInLayer(this.vertical, distance, layer, surface);
  }

  private visibleBreadth(): number {
    return this.scroller.visibleBreadth();
  }

  // ---- 組み ----

  /**
   * 寸法 → 組み → 送れる上限 の順に揃える。
   * 上限は組み上がりから決まるので、測って確定させたあとでないと古い値のままになる。
   * そのあとに送ると、送りがその古い上限で丸められる
   */
  private syncGeometry(): void {
    this.syncMetrics();
    // getBoundingClientRect が組みを確定させる
    this.syncLayerBreadth();
    this.syncSpacer();
  }

  /**
   * 行の長さを px で入れる。% のままだと block 方向を決める段階で
   * inline 方向が未定になり、縦書き (直交フロー) の幅が決まらない。
   */
  private syncMetrics(): void {
    const { padding } = this.metrics;
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

  /** スクロールできる量を maxScroll に合わせる。器のぶんを足した大きさが要る */
  private syncSpacer(): void {
    const vertical = this.vertical;
    const visible = vertical ? this.surface.clientWidth : this.surface.clientHeight;
    const extent = visible + this.scroller.maxScroll();
    Object.assign(this.spacer.style, {
      width: vertical ? `${extent}px` : "1px",
      height: vertical ? "1px" : `${extent}px`,
    } satisfies Partial<CSSStyleDeclaration>);
  }

  private applyStyles(): void {
    // 字の大きさや組み方が変われば行送りも変わる。測り直す
    this.pitch = null;
    const { writingMode, theme } = this.options;
    const { padding } = this.metrics;
    const vertical = this.vertical;

    // 縦組みの I ビームは横向き。text は横書き用
    this.surface.style.cursor = vertical ? "vertical-text" : "text";

    // surface 自身を writingMode に置くと、送り方向のはみ出しがスクロール領域になる。
    // vertical-rl では左へ伸びるので scrollLeft は 0 から負へ動く。
    // touch-action を送り方向だけ開けて、パンはブラウザ、タップと長押しは pointer 側で拾う
    Object.assign(this.surface.style, {
      writingMode,
      overflowX: vertical ? "auto" : "hidden",
      overflowY: vertical ? "hidden" : "auto",
      touchAction: vertical ? "pan-x" : "pan-y",
    } satisfies Partial<CSSStyleDeclaration>);

    // font と line-break は container から継承させる。ここで書くと CSS を上書きしてしまう
    const common = {
      position: "absolute",
      top: "0",
      left: vertical ? "auto" : "0",
      right: vertical ? "0" : "auto",
      writingMode,
      whiteSpace: "pre-wrap",
      wordBreak: "normal",
      // ネイティブの textarea (wrap=soft) と同じ。1 行に収まらない綴りは割る
      overflowWrap: "break-word",
      // 選択は自前で描くので、ブラウザの選択は出させない
      userSelect: "none",
      WebkitUserSelect: "none",
    } as Partial<CSSStyleDeclaration>;

    Object.assign(this.layer.style, {
      top: `${padding.top}px`,
      left: vertical ? "auto" : `${padding.left}px`,
      right: vertical ? `${padding.right}px` : "auto",
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
    this.pitch = null;

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
      Object.assign(span.style, {
        textDecoration: "underline",
        textDecorationThickness: active ? "2px" : "1px",
        textDecorationColor: active
          ? this.options.theme.compositionActive
          : this.options.theme.composition,
      } satisfies Partial<CSSStyleDeclaration>);
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

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      // 器が変われば行の長さも変わって全部組み直る。
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
      const thickness = CARET_WIDTH;
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

    this.paintHandles(layer);
  }

  /** 選択の端に丸いつまみを描く。キャレットの棒の先に置く */
  private paintHandles(layer: DOMRect): void {
    const points = this.handlePoints();
    if (points.length === 0) return;
    const doc = this.container.ownerDocument;
    const surface = this.surface.getBoundingClientRect();

    for (const [edge, center] of points) {
      const dot = doc.createElement("div");
      dot.dataset.handle = edge;
      Object.assign(dot.style, {
        position: "absolute",
        background: this.options.theme.caret,
        borderRadius: "50%",
        left: `${surface.x + center.x - layer.x - HANDLE_RADIUS}px`,
        top: `${surface.y + center.y - layer.y - HANDLE_RADIUS}px`,
        width: `${HANDLE_RADIUS * 2}px`,
        height: `${HANDLE_RADIUS * 2}px`,
      } satisfies Partial<CSSStyleDeclaration>);
      this.caretLayer.appendChild(dot);
    }
  }
}

/**
 * 組みに要る寸法を container の計算スタイルから読む。
 *
 * font も padding も禁則も CSS に置いたので、値はここからしか来ない。
 * padding を数値で取り直しているのは、surface が inset:0 で padding box に
 * 載る (= 余白のぶんは詰まらない) ため。余白は layer の位置と送りの余裕として
 * 自分で使う。ネイティブの textarea と同じく、字は余白の下まで送れる。
 */
function readMetrics(container: HTMLElement): Metrics {
  const view = container.ownerDocument.defaultView;
  const style = view?.getComputedStyle(container);
  const size = px(style?.fontSize, 16);
  // line-height: normal は px に解決されない。測れなかったときの代用なので目安で足りる
  const lineHeight = px(style?.lineHeight, size * 1.2);
  return {
    css: `${style?.fontWeight ?? "400"} ${size}px ${style?.fontFamily ?? "serif"}`,
    size,
    lineHeight,
    padding: {
      top: px(style?.paddingTop, 0),
      right: px(style?.paddingRight, 0),
      bottom: px(style?.paddingBottom, 0),
      left: px(style?.paddingLeft, 0),
    },
  };
}

function sameMetrics(a: Metrics, b: Metrics): boolean {
  return (
    a.css === b.css &&
    a.size === b.size &&
    a.lineHeight === b.lineHeight &&
    a.padding.top === b.padding.top &&
    a.padding.right === b.padding.right &&
    a.padding.bottom === b.padding.bottom &&
    a.padding.left === b.padding.left
  );
}

function px(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
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
