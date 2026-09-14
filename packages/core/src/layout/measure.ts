import type { Orientation } from "../text/char-class";
import type { FontStyle } from "../types";

export interface Measurer {
  /** 全角 1 文字の送り量 */
  readonly em: number;
  /** 縦書きでの送り量 */
  advance(text: string, orientation: Orientation): number;
  /** 横書きで測った字幅 */
  width(text: string): number;
}

export function cssFont(font: FontStyle): string {
  return `${font.weight} ${font.size}px ${font.family}`;
}

/** canvas の measureText で測る。同じ字を何度も測るのでキャッシュする */
export class CanvasMeasurer implements Measurer {
  private cache = new Map<string, number>();
  private font: FontStyle;

  constructor(
    private ctx: CanvasRenderingContext2D,
    font: FontStyle,
  ) {
    this.font = font;
    this.ctx.font = cssFont(font);
  }

  get em(): number {
    return this.font.size;
  }

  setFont(font: FontStyle): void {
    this.font = font;
    this.ctx.font = cssFont(font);
    this.cache.clear();
  }

  /** 呼び出し側が ctx.font を触ったあとに戻すため */
  applyFont(): void {
    this.ctx.font = cssFont(this.font);
  }

  width(text: string): number {
    const hit = this.cache.get(text);
    if (hit !== undefined) return hit;
    const width = this.ctx.measureText(text).width;
    this.cache.set(text, width);
    return width;
  }

  advance(text: string, orientation: Orientation): number {
    return orientation === "rotate" ? this.width(text) : this.font.size;
  }
}
