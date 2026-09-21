import { DomBackend } from "./backend/dom/backend";
import { Textarea } from "./textarea";
import { resolveOptions, type TextareaOptions } from "./types";

export class DomTextarea extends Textarea {
  constructor(container: HTMLElement, options: TextareaOptions = {}) {
    super(container, { ...options, backend: new DomBackend(container, resolveOptions(options)) });
  }
}
