import type { ResolvedOptions } from "../../types";

/**
 * 重ねる要素を組んで、CSS から読んだ寸法を当てる。
 *
 * **見た目の指定はここだけ。**字の大きさ・行送り・余白・禁則は container の
 * 計算スタイルから来るので、読むのもここに閉じる。
 * どこに何が落ちたかを引くのは geometry で、こちらは落とし方を決める側。
 */

/** 重ねる要素一式。作るのも当てるのもここ */
export interface Elements {
  /** スクロールコンテナ。ポインタもホイールもここで拾う */
  surface: HTMLElement;
  /** スクロールできる量をブラウザに持たせるための場所取り */
  spacer: HTMLElement;
  /** 本文を載せる層。block 始端を起点に伸びる */
  layer: HTMLElement;
  content: HTMLElement;
  placeholder: HTMLElement;
  selectionLayer: HTMLElement;
  caretLayer: HTMLElement;
}

/** container の計算スタイルから読んだ、レイアウトに要る寸法 */
export interface Metrics {
  /** font の短縮形。fontBoxSize に渡す */
  css: string;
  size: number;
  /** 行送り (px)。実測できなかったときの代用 */
  lineHeight: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

/** 要素を組んで container に差す。向きに依る指定は applyStyles で入れる */
export function createElements(container: HTMLElement): Elements {
  const doc = container.ownerDocument;
  const div = () => doc.createElement("div");

  const surface = div();
  Object.assign(surface.style, {
    position: "absolute",
    inset: "0",
  } satisfies Partial<CSSStyleDeclaration>);

  // 絶対配置でも containing block である surface のスクロール領域を広げる
  const layer = div();
  layer.style.position = "absolute";

  // 絶対配置のはみ出しをスクロール領域として当てにすると、コンテナが変わったときの
  // 追従がエンジン任せになる。スクロールできる量は自分で置く
  const spacer = div();

  const content = div();
  const placeholder = div();
  const selectionLayer = div();
  const caretLayer = div();
  for (const el of [selectionLayer, caretLayer]) {
    Object.assign(el.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
  }

  // 絶対配置は DOM 順に関わらず通常フローの上に来る。重なりは z-index で決める
  selectionLayer.style.zIndex = "0";
  caretLayer.style.zIndex = "2";
  layer.append(selectionLayer, content, placeholder, caretLayer);
  surface.append(spacer, layer);
  container.appendChild(surface);

  return { surface, spacer, layer, content, placeholder, selectionLayer, caretLayer };
}

export function applyStyles(els: Elements, options: ResolvedOptions, metrics: Metrics): void {
  const { writingMode, theme } = options;
  const { padding } = metrics;
  const vertical = writingMode === "vertical-rl";

  // 縦組みの I ビームは横向き。text は横書き用
  els.surface.style.cursor = vertical ? "vertical-text" : "text";

  // surface 自身を writingMode に置くと、スクロール方向のはみ出しがスクロール領域になる。
  // vertical-rl では左へ伸びるので scrollLeft は 0 から負へ動く。
  // touch-action をスクロール方向だけ開けて、パンはブラウザ、タップと長押しは pointer 側で拾う
  Object.assign(els.surface.style, {
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

  Object.assign(els.layer.style, {
    top: `${padding.top}px`,
    left: vertical ? "auto" : `${padding.left}px`,
    right: vertical ? `${padding.right}px` : "auto",
  } satisfies Partial<CSSStyleDeclaration>);

  Object.assign(els.content.style, common, {
    position: "relative",
    zIndex: "1",
    color: theme.text,
  } satisfies Partial<CSSStyleDeclaration>);
  Object.assign(els.placeholder.style, common, {
    zIndex: "1",
    color: theme.placeholder,
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  if (theme.background !== "transparent") els.surface.style.background = theme.background;
}

/**
 * 行の長さを px で入れる。% のままだと block 方向を決める段階で
 * inline 方向が未定になり、縦書き (直交フロー) の幅が決まらない。
 */
export function syncMetrics(els: Elements, metrics: Metrics, vertical: boolean): void {
  const { padding } = metrics;
  const length = Math.max(
    0,
    vertical
      ? els.surface.clientHeight - padding.top - padding.bottom
      : els.surface.clientWidth - padding.left - padding.right,
  );
  const key = vertical ? "height" : "width";
  const other = vertical ? "width" : "height";
  for (const el of [els.layer, els.content, els.placeholder]) {
    el.style[key] = `${length}px`;
    if (el !== els.layer) el.style[other] = "";
  }
}

/**
 * layer の block 方向の大きさは content に合わせる。
 * auto (shrink-to-fit) も max-content も、縦書きの子は直交フローなので
 * Chrome が中身の変更で intrinsic を計算し直さず、桁違いの値のまま残る。
 * content 自身は行の長さだけで決まるので、測って入れる。
 */
export function syncLayerBreadth(els: Elements, vertical: boolean): void {
  const box = els.content.getBoundingClientRect();
  if (vertical) els.layer.style.width = `${box.width}px`;
  else els.layer.style.height = `${box.height}px`;
}

/** スクロールできる量を maxScroll に合わせる。コンテナのぶんを足した大きさが要る */
export function syncSpacer(els: Elements, vertical: boolean, maxScroll: number): void {
  const visible = vertical ? els.surface.clientWidth : els.surface.clientHeight;
  const extent = visible + maxScroll;
  Object.assign(els.spacer.style, {
    width: vertical ? `${extent}px` : "1px",
    height: vertical ? "1px" : `${extent}px`,
  } satisfies Partial<CSSStyleDeclaration>);
}

/**
 * レイアウトに要る寸法を container の計算スタイルから読む。
 *
 * font も padding も禁則も CSS に置いたので、値はここからしか来ない。
 * padding を数値で取り直しているのは、surface が inset:0 で padding box に
 * 載る (= 余白のぶんは詰まらない) ため。余白は layer の位置とスクロールの余裕として
 * 自分で使う。ネイティブの textarea と同じく、字は余白の下までスクロールできる。
 */
export function readMetrics(container: HTMLElement): Metrics {
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

export function sameMetrics(a: Metrics, b: Metrics): boolean {
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
