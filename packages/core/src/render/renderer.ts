import type { CompositionRange } from "../backend";
import type { Geometry, Rect } from "../layout/geometry";
import { caretGeometry, isVertical, selectionRects, toPhysical } from "../layout/geometry";
import type { Layout, PlacedChar } from "../layout/layout";
import { cssFont } from "../layout/measure";
import type { Caret } from "../model/movement";
import { isSmallKana } from "../text/char-class";
import type { ResolvedOptions } from "../types";

/** ネイティブの textarea と同じで、字の大きさには比例しない (CSS px) */
const CARET_WIDTH = 1;

export interface RenderState {
  layout: Layout;
  geometry: Geometry;
  selection: { start: number; end: number };
  caret: Caret | null;
  focused: boolean;
  composition: CompositionRange | null;
  /** 本文が空のときに薄く出す。無ければ null */
  placeholder: Layout | null;
}

export class Renderer {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private options: ResolvedOptions,
  ) {}

  setOptions(options: ResolvedOptions): void {
    this.options = options;
  }

  render(state: RenderState, devicePixelRatio: number): void {
    const { ctx } = this;
    const { geometry, layout } = state;

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, geometry.width, geometry.height);
    if (this.options.theme.background !== "transparent") {
      ctx.fillStyle = this.options.theme.background;
      ctx.fillRect(0, 0, geometry.width, geometry.height);
    }

    ctx.font = cssFont(this.options.font);
    ctx.textBaseline = "middle";

    this.drawSelection(state);
    this.drawLines(
      state.placeholder ?? layout,
      geometry,
      state.placeholder ? this.options.theme.placeholder : this.options.theme.text,
    );
    if (state.composition) this.drawComposition(state);
    if (state.caret && state.focused) this.drawCaret(state);
  }

  private drawSelection(state: RenderState): void {
    const { start, end } = state.selection;
    if (start === end) return;
    this.ctx.fillStyle = state.focused
      ? this.options.theme.selection
      : this.options.theme.selectionInactive;
    for (const rect of selectionRects(state.layout, state.geometry, start, end)) {
      this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  private drawLines(layout: Layout, geometry: Geometry, color: string): void {
    this.ctx.fillStyle = color;
    const vertical = isVertical(geometry);
    const limit = vertical ? geometry.width : geometry.height;

    for (const line of layout.lines) {
      const head = toPhysical(geometry, line.index, 0);
      // 画面の外に出た行は描かない
      const block = vertical ? head.x : head.y;
      if (block < -geometry.lineHeight || block > limit + geometry.lineHeight) continue;

      for (const ch of line.chars) {
        const at = toPhysical(geometry, line.index, ch.offset);
        if (vertical) this.drawUpright(ch, at.x - geometry.lineHeight / 2, at.y);
        else this.drawFlat(ch, at.x, at.y + geometry.lineHeight / 2);
      }
    }
  }

  /** 横書き。字を倒す必要も寄せる必要も無い */
  private drawFlat(ch: PlacedChar, x: number, middle: number): void {
    this.ctx.textAlign = "left";
    this.ctx.fillText(ch.text, x, middle);
  }

  /** 縦書き。UAX #50 の分類ごとに置き方を変える */
  private drawUpright(ch: PlacedChar, center: number, top: number): void {
    const { ctx } = this;
    const size = this.options.font.size;

    switch (ch.orientation) {
      case "upright": {
        let x = center;
        let y = top + ch.advance / 2;
        if (this.options.smallKanaShift > 0 && isSmallKana(ch.text)) {
          const shift = size * this.options.smallKanaShift;
          x += shift;
          y -= shift;
        }
        ctx.textAlign = "center";
        ctx.fillText(ch.text, x, y);
        break;
      }
      case "corner": {
        // 横書きでは字面が em ボックスの左下にある。縦書きの定位置は右上
        ctx.textAlign = "center";
        ctx.fillText(ch.text, center + size / 2, top + ch.advance / 2 - size / 2);
        break;
      }
      case "rotate": {
        ctx.save();
        ctx.translate(center, top);
        ctx.rotate(Math.PI / 2);
        // 回した先では +x が送り方向 (下)、textBaseline middle が列の中心に乗る
        ctx.textAlign = "left";
        ctx.fillText(ch.text, 0, 0);
        ctx.restore();
        break;
      }
    }
  }

  private drawComposition(state: RenderState): void {
    const composition = state.composition;
    if (!composition) return;
    const { geometry, layout } = state;
    const { ctx } = this;
    const vertical = isVertical(geometry);

    const draw = (from: number, to: number, color: string, thickness: number) => {
      if (from >= to) return;
      ctx.fillStyle = color;
      for (const rect of selectionRects(layout, geometry, from, to)) {
        // 下線は行の block-end 側。縦書きなら左、横書きなら下
        const gap = (geometry.lineHeight - geometry.em) / 2;
        if (vertical) ctx.fillRect(rect.x + gap - thickness, rect.y, thickness, rect.height);
        else ctx.fillRect(rect.x, rect.y + rect.height - gap, rect.width, thickness);
      }
    };

    draw(composition.start, composition.end, this.options.theme.composition, 1);
    draw(composition.activeStart, composition.activeEnd, this.options.theme.compositionActive, 2);
  }

  private drawCaret(state: RenderState): void {
    const caret = state.caret;
    if (!caret) return;
    const { geometry, layout } = state;
    const rect: Rect = caretGeometry(layout, geometry, caret.offset, caret.preferEnd);

    this.ctx.fillStyle = this.options.theme.caret;
    // 境界の上に中心を置く。ネイティブも caret_left -= caret_width / 2 している
    if (isVertical(geometry)) {
      this.ctx.fillRect(rect.x, rect.y - CARET_WIDTH / 2, rect.width, CARET_WIDTH);
    } else {
      this.ctx.fillRect(rect.x - CARET_WIDTH / 2, rect.y, CARET_WIDTH, rect.height);
    }
  }
}
