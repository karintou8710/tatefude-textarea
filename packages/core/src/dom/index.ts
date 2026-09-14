import type { VertTextareaOptions } from "../types";
import { VertTextarea } from "../vert-textarea";
import { DomBackend } from "./backend";

export class DomVertTextarea extends VertTextarea {
  constructor(container: HTMLElement, options: VertTextareaOptions = {}) {
    super(container, options, (host, resolved) => new DomBackend(host, resolved));
  }
}
