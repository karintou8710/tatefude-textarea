import type { CanvasStyleOptions } from "../src/backend/canvas/style";
import { defaultFont } from "../src/backend/canvas/style";

/**
 * 見た目の指定は 2 つの経路に分かれた。
 * dom は container の CSS から読み、canvas は生成時に凍らせる。
 * 突き合わせるテストでは両方に同じ値を入れないと揃わないので、ここでまとめる。
 */
export interface TestStyle {
  size: number;
  lineHeight: number;
  padding: number;
  family?: string;
}

export function applyStyle(el: HTMLElement, style: TestStyle): void {
  Object.assign(el.style, {
    // padding を実 CSS に置いたので、コンテナの寸法に足されないよう border-box に寄せる
    boxSizing: "border-box",
    fontFamily: style.family ?? defaultFont.family,
    fontSize: `${style.size}px`,
    lineHeight: `${style.lineHeight}`,
    fontWeight: defaultFont.weight,
    padding: `${style.padding}px`,
    // 既定の禁則。canvas 側の kinsoku: true と揃える
    lineBreak: "strict",
  } satisfies Partial<CSSStyleDeclaration>);
}

export function canvasStyle(style: TestStyle): CanvasStyleOptions {
  return {
    font: {
      size: style.size,
      lineHeight: style.lineHeight,
      ...(style.family ? { family: style.family } : {}),
    },
    padding: style.padding,
  };
}
