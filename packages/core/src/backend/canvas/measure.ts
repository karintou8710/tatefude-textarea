import type { Orientation } from "./char-class";
import type { FontStyle } from "./style";

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
  private uprightCache = new Map<string, number>();
  private probe: HTMLElement | null = null;
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
    this.uprightCache.clear();
    this.probe?.remove();
    this.probe = null;
  }

  destroy(): void {
    this.probe?.remove();
    this.probe = null;
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
    return orientation === "rotate" ? this.width(text) : this.upright(text);
  }

  /**
   * 立てた字の縦の送り。1em とは限らない。
   * フォントに縦組みの寸法 (vmtx) があればその値が使われ、無ければブラウザが
   * ascent + descent から作る。どちらも canvas の measureText からは引けないので、
   * 同じ字を実際に縦組みで組ませて測る。落ちるフォントは字ごとに変わるので 1 字ずつ。
   */
  private upright(text: string): number {
    const hit = this.uprightCache.get(text);
    if (hit !== undefined) return hit;

    const probe = this.uprightProbe();
    let advance = this.font.size;
    if (probe) {
      probe.textContent = text;
      advance = probe.getBoundingClientRect().height || this.font.size;
    }
    this.uprightCache.set(text, advance);
    return advance;
  }

  /** 測るためだけの、目に見えない縦組みの箱 */
  private uprightProbe(): HTMLElement | null {
    if (this.probe) return this.probe;
    const doc = this.ctx.canvas.ownerDocument;
    const body = doc?.body;
    if (!body) return null;

    const probe = doc.createElement("span");
    Object.assign(probe.style, {
      position: "absolute",
      top: "0",
      left: "0",
      visibility: "hidden",
      pointerEvents: "none",
      whiteSpace: "pre",
      // ページ側の * { padding } などに巻き込まれると測り違える
      margin: "0",
      padding: "0",
      border: "0",
      // 行送りは送り量に効かせない。字そのものの送りだけが要る
      writingMode: "vertical-rl",
      font: `${this.font.weight} ${this.font.size}px/1 ${this.font.family}`,
    } satisfies Partial<CSSStyleDeclaration>);
    body.appendChild(probe);
    this.probe = probe;
    return probe;
  }
}
