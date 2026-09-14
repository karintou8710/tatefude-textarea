import { Textarea } from "../textarea";
import type { TextareaOptions } from "../types";
import { CanvasBackend } from "./backend";

export class CanvasTextarea extends Textarea {
  constructor(container: HTMLElement, options: TextareaOptions = {}) {
    super(container, options, (host, resolved) => new CanvasBackend(host, resolved));
  }
}
