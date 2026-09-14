import type { CompositionRange } from "../backend";
import type { Geometry } from "../layout/geometry";
import { caretGeometry, lineCenterX, lineStartY, selectionRects } from "../layout/geometry";
import type { Layout, PlacedChar } from "../layout/layout";
import { cssFont } from "../layout/measure";
import { isSmallKana } from "../text/char-class";
import type { ResolvedOptions } from "../types";

export interface RenderState {
  layout: Layout;
  geometry: Geometry;
  selection: { start: number; end: number };
  caret: { offset: number; preferEnd: boolean } | null;
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
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    this.drawSelection(state);

    if (state.placeholder) {
      this.drawLines(state.placeholder, geometry, this.options.theme.placeholder);
    } else {
      this.drawLines(layout, geometry, this.options.theme.text);
    }

    if (state.composition) this.drawComposition(state);
    if (state.caret && state.focused) this.drawCaret(state);
  }

  private drawSelection(state: RenderState): void {
    const { start, end } = state.selection;
    if (start === end) return;
    const rects = selectionRects(state.layout, state.geometry, start, end);
    this.ctx.fillStyle = state.focused
      ? this.options.theme.selection
      : this.options.theme.selectionInactive;
    for (const rect of rects) {
      this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  private drawLines(layout: Layout, geometry: Geometry, color: string): void {
    this.ctx.fillStyle = color;
    const top = lineStartY(geometry);
    const left = -geometry.lineHeight;
    const right = geometry.width + geometry.lineHeight;

    for (const line of layout.lines) {
      const cx = lineCenterX(geometry, line.index);
      // 画面の外に出た行は描かない
      if (cx < left || cx > right) continue;
      for (const ch of line.chars) {
        this.drawChar(ch, cx, top + ch.offset);
      }
    }
  }

  private drawChar(ch: PlacedChar, cx: number, top: number): void {
    const { ctx } = this;
    const size = this.options.font.size;

    switch (ch.orientation) {
      case "upright": {
        let x = cx;
        let y = top + ch.advance / 2;
        if (this.options.smallKanaShift > 0 && isSmallKana(ch.text)) {
          const shift = size * this.options.smallKanaShift;
          x += shift;
          y -= shift;
        }
        ctx.fillText(ch.text, x, y);
        break;
      }
      case "corner": {
        // 横書きでは字面が em ボックスの左下にある。縦書きの定位置は右上
        ctx.fillText(ch.text, cx + size / 2, top + ch.advance / 2 - size / 2);
        break;
      }
      case "rotate": {
        ctx.save();
        ctx.translate(cx, top);
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

    const draw = (from: number, to: number, color: string, thickness: number) => {
      if (from >= to) return;
      ctx.fillStyle = color;
      for (const rect of selectionRects(layout, geometry, from, to)) {
        // 縦書きの下線は行の左側 (block-end 側) に引く
        const x = rect.x + (geometry.lineHeight - geometry.em) / 2 - thickness;
        ctx.fillRect(x, rect.y, thickness, rect.height);
      }
    };

    draw(composition.start, composition.end, this.options.theme.composition, 1);
    draw(composition.activeStart, composition.activeEnd, this.options.theme.compositionActive, 2);
  }

  private drawCaret(state: RenderState): void {
    const caret = state.caret;
    if (!caret) return;
    const { geometry, layout } = state;
    const rect = caretGeometry(layout, geometry, caret.offset, caret.preferEnd);
    const thickness = Math.max(1, Math.round(geometry.em / 14));

    this.ctx.fillStyle = this.options.theme.caret;
    this.ctx.fillRect(rect.x - rect.size / 2, rect.y - thickness / 2, rect.size, thickness);
  }
}
