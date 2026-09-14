import type { VertTextareaOptions } from "../types";
import { VertTextarea } from "../vert-textarea";
import { CanvasBackend } from "./backend";

export class CanvasVertTextarea extends VertTextarea {
  constructor(container: HTMLElement, options: VertTextareaOptions = {}) {
    super(container, options, (host, resolved) => new CanvasBackend(host, resolved));
  }
}
