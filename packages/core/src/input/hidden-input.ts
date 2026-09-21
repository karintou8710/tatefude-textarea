import type { Command } from "../edit/command";
import type { CaretRect } from "../layout";
import { commandFor, strokeOf } from "./keymap";
import type { Input, InputOptions } from "./receivers";

export interface HiddenInputHandlers {
  insert(text: string): void;
  compositionStart(): void;
  compositionUpdate(text: string, activeStart: number, activeEnd: number): void;
  compositionEnd(text: string): void;
  /**
   * キーが押された。割り当てが無ければ null。
   * 何のキーでも来るのは、打ったらつまみを引っ込めるため
   */
  keyDown(command: Command | null): void;
  /** キャレットの居場所と、全角 1 文字ぶん。候補ウィンドウを脇に出すのに要る */
  caretAnchor(): { rect: CaretRect; size: number };
  copy(): string;
  cut(): string;
  paste(text: string): void;
  focus(): void;
  blur(): void;
}

/**
 * 画面に出さない textarea。IME とクリップボードはブラウザに任せたいので、
 * 入力を受けるのはこの要素で、canvas は描くだけにする。
 */
export class HiddenInput implements Input {
  readonly element: HTMLTextAreaElement;
  private container: HTMLElement;
  private composing = false;
  private disposers: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private handlers: HiddenInputHandlers,
    private options: InputOptions,
  ) {
    this.container = container;
    const element = container.ownerDocument.createElement("textarea");
    element.setAttribute("autocapitalize", "off");
    element.setAttribute("autocorrect", "off");
    element.setAttribute("autocomplete", "off");
    element.setAttribute("spellcheck", "false");
    element.setAttribute("aria-hidden", "false");
    element.tabIndex = 0;
    element.rows = 1;
    Object.assign(element.style, {
      position: "absolute",
      top: "0px",
      left: "0px",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "0",
      border: "none",
      outline: "none",
      resize: "none",
      overflow: "hidden",
      // 変換中の文字と候補ウィンドウを縦に出させる
      writingMode: "vertical-rl",
      // 行間があると変換中の文字が行の中で寄る。moveTo の計算を単純に保つ
      lineHeight: "1",
      // 1px でも下の面と同じ形にしておく
      cursor: "vertical-text",
      // display:none や visibility:hidden にすると IME が動かない
      opacity: "0",
      background: "transparent",
      color: "transparent",
      caretColor: "transparent",
      zIndex: "1",
      whiteSpace: "pre",
    } satisfies Partial<CSSStyleDeclaration>);

    container.appendChild(element);
    this.element = element;
    this.applyOptions();
    this.bind();
    this.observeResize();
  }

  /**
   * キャレットの脇へ置き直す。キャレットが動いたら呼んでもらう。
   *
   * 置いたままだと、キーボードでコンテナが縮んだときに入力がその下へ取り残され、
   * iOS が開いた直後にキーボードを閉じてしまう。だからコンテナ自身も見ている
   */
  followCaret(): void {
    const { rect, size } = this.handlers.caretAnchor();
    this.moveTo(rect, size);
  }

  /**
   * コンテナが変わればレイアウトし直されるので、そのあとに置き直す。
   * backend より後に作られるので、レイアウトし直した結果を見てから動ける
   */
  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (this.element.ownerDocument.activeElement === this.element) this.followCaret();
    });
    observer.observe(this.container);
    this.disposers.push(() => observer.disconnect());
  }

  private bind(): void {
    const el = this.element;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, listener as EventListener);
      this.disposers.push(() => el.removeEventListener(type, listener as EventListener));
    };

    on("compositionstart", () => {
      this.composing = true;
      this.handlers.compositionStart();
    });

    on("compositionend", (event) => {
      this.composing = false;
      const text = event.data ?? el.value;
      el.value = "";
      this.handlers.compositionEnd(text);
    });

    on("input", (event) => {
      const inputEvent = event as InputEvent;
      if (this.composing) {
        // compositionupdate の時点では value と選択が古いことがあるので、ここで読む
        this.handlers.compositionUpdate(
          el.value,
          el.selectionStart ?? el.value.length,
          el.selectionEnd ?? el.value.length,
        );
        return;
      }
      // compositionend が先に来たあとの取りこぼし。中身は既に確定済み
      if (inputEvent.inputType === "insertCompositionText" || inputEvent.isComposing) {
        el.value = "";
        return;
      }
      const value = el.value;
      el.value = "";
      if (value) this.handlers.insert(value);
    });

    on("keydown", (event) => {
      if (this.composing || event.isComposing || event.keyCode === 229) return;
      // キーの割り当てはここで済ませる。外へ出すのは「何をするか」だけ
      const command = commandFor(strokeOf(event), this.options.writingMode);
      if (command) event.preventDefault();
      this.handlers.keyDown(command);
    });

    on("copy", (event) => {
      event.preventDefault();
      event.clipboardData?.setData("text/plain", this.handlers.copy());
    });

    on("cut", (event) => {
      event.preventDefault();
      event.clipboardData?.setData("text/plain", this.handlers.cut());
    });

    on("paste", (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text) this.handlers.paste(text);
    });

    on("focus", () => this.handlers.focus());
    on("blur", () => {
      this.composing = false;
      this.handlers.blur();
    });
  }

  get isComposing(): boolean {
    return this.composing;
  }

  /**
   * IME の候補ウィンドウをキャレットの脇に出させる。
   * 縦組みの中身は右端から左へ伸びるので、要素の右端を行の右端に合わせると
   * 変換中の文字がちょうどキャレットの行に乗る (line-height: 1 が前提)。
   *
   * @param rect キャレットの矩形。container 基準で、行を横切る向きは行ボックス全体
   * @param size 全角 1 文字ぶん。変換中の字は行ボックスではなくこの幅に乗る
   */
  private moveTo(
    rect: { x: number; y: number; width: number; height: number },
    size: number,
  ): void {
    const style = this.element.style;
    const mode = this.options.writingMode;
    const vertical = mode === "vertical-rl";
    const center = vertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
    style.writingMode = mode;
    style.cursor = vertical ? "vertical-text" : "text";
    // コンテナの外へ出すと iOS がキーボードを開いた直後に閉じる。端で止める
    const left = vertical ? Math.round(center + size / 2) - 1 : Math.round(rect.x);
    const top = vertical ? Math.round(rect.y) : Math.round(center - size / 2);
    style.left = `${clamp(left, 0, this.container.clientWidth - 1)}px`;
    style.top = `${clamp(top, 0, this.container.clientHeight - 1)}px`;
    style.fontSize = `${size}px`;
  }

  setOptions(options: InputOptions): void {
    this.options = options;
    this.applyOptions();
  }

  /** DOM に書き込むものだけ当てる。writingMode は読むときに引く */
  private applyOptions(): void {
    this.element.readOnly = this.options.readOnly;
    this.element.disabled = this.options.disabled;
  }

  focus(): void {
    this.element.focus({ preventScroll: true });
  }

  blur(): void {
    this.element.blur();
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.element.remove();
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return value < min ? min : value > max ? max : value;
}
