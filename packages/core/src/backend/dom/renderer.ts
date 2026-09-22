import type { ResolvedOptions } from "../../types";
import type { CaretRect, Handle } from "../backend";
import { HANDLE_RADIUS, type HandlePoint } from "../handle";
import type { Axis, Rect } from "./axis";

/**
 * 選択・キャレット・ハンドルを、本文の上に重ねた層へ置く。
 *
 * **測らない。**どこに何を置くかは geometry が決めたものを受け取るだけで、
 * ここがやるのは矩形を div にして色を塗ることだけ。
 * 本文そのものはブラウザが描くので、この層には出てこない。
 */

/** ネイティブの textarea と同じで、字の大きさには比例しない (CSS px) */
const CARET_WIDTH = 1;

/** いま重ねるもの。測り終えた矩形だけで組む */
export interface Overlay {
  axis: Axis;
  focused: boolean;
  /** 選択の矩形 (クライアント座標)。空なら選択を描かない */
  selection: readonly Rect[];
  /** キャレットの矩形 (surface 基準)。null なら描かない */
  caret: CaretRect | null;
  /** ハンドルの中心 (surface 基準) */
  handles: readonly [edge: Handle, center: HandlePoint][];
}

export class Renderer {
  constructor(
    private doc: Document,
    private selectionLayer: HTMLElement,
    private caretLayer: HTMLElement,
    /** 引きに行く。写しを持つと、当て直すものが無いのに同期が要る */
    private readOptions: () => ResolvedOptions,
  ) {}

  private get options(): ResolvedOptions {
    return this.readOptions();
  }

  paint(overlay: Overlay): void {
    this.selectionLayer.textContent = "";
    this.caretLayer.textContent = "";
    this.paintSelection(overlay);
    this.paintCaret(overlay);
    this.paintHandles(overlay);
  }

  private paintSelection({ axis, selection, focused }: Overlay): void {
    const { theme } = this.options;
    const color = focused ? theme.selection : theme.selectionInactive;
    const { layer, vertical, lineHeight } = axis;

    for (const rect of selection) {
      // 字の矩形は em ぶんしかない。行の幅まで広げて隣の行と繋げる
      const grow = (size: number) => (lineHeight - size) / 2;
      this.selectionLayer.appendChild(
        this.box({
          background: color,
          left: `${rect.x - layer.x - (vertical ? grow(rect.width) : 0)}px`,
          top: `${rect.y - layer.y - (vertical ? 0 : grow(rect.height))}px`,
          width: `${vertical ? lineHeight : rect.width}px`,
          height: `${vertical ? rect.height : lineHeight}px`,
        }),
      );
    }
  }

  private paintCaret({ axis, caret }: Overlay): void {
    if (!caret) return;
    // 矩形は surface 基準。置くのは layer の中なので原点を移す
    const { layer, surface, vertical } = axis;
    const bar = this.box({
      background: this.options.theme.caret,
      left: `${surface.x + caret.x - layer.x - (vertical ? 0 : CARET_WIDTH / 2)}px`,
      top: `${surface.y + caret.y - layer.y - (vertical ? CARET_WIDTH / 2 : 0)}px`,
      width: `${vertical ? caret.width : CARET_WIDTH}px`,
      height: `${vertical ? CARET_WIDTH : caret.height}px`,
    });
    bar.dataset.caret = "";
    this.caretLayer.appendChild(bar);
  }

  /** 選択の端に丸いハンドルを描く。キャレットの棒の先に置く */
  private paintHandles({ axis, handles }: Overlay): void {
    const { layer, surface } = axis;
    for (const [edge, center] of handles) {
      const dot = this.box({
        background: this.options.theme.caret,
        borderRadius: "50%",
        left: `${surface.x + center.x - layer.x - HANDLE_RADIUS}px`,
        top: `${surface.y + center.y - layer.y - HANDLE_RADIUS}px`,
        width: `${HANDLE_RADIUS * 2}px`,
        height: `${HANDLE_RADIUS * 2}px`,
      });
      dot.dataset.handle = edge;
      this.caretLayer.appendChild(dot);
    }
  }

  private box(style: Partial<CSSStyleDeclaration>): HTMLElement {
    const el = this.doc.createElement("div");
    Object.assign(el.style, { position: "absolute" }, style);
    return el;
  }
}
