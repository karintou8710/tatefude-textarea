import { Textarea } from "../textarea";
import type { TextareaOptions } from "../types";
import { DomBackend } from "./backend";

export class DomTextarea extends Textarea {
  constructor(container: HTMLElement, options: TextareaOptions = {}) {
    super(container, options, (host, resolved) => new DomBackend(host, resolved));
  }
}
