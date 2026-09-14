import { Textarea } from "../../textarea";
import type { TextareaOptions } from "../../types";
import { CanvasBackend } from "./backend";
import { type CanvasStyleOptions, resolveCanvasStyle } from "./style";

/**
 * 字を 1 つずつ canvas に置く実装。公開していない。
 *
 * dom 側は見た目を CSS から読むが、canvas は色も寸法も数値で要る。
 * その要求を公開 API に出さないために、ここで受けて生成時に凍らせる。
 */
export class CanvasTextarea extends Textarea {
  constructor(
    container: HTMLElement,
    options: TextareaOptions = {},
    style: CanvasStyleOptions = {},
  ) {
    const resolvedStyle = resolveCanvasStyle(style);
    super(container, options, (host, resolved) => new CanvasBackend(host, resolved, resolvedStyle));
  }
}
