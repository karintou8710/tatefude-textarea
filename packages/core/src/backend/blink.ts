/**
 * キャレットの点滅。
 *
 * 出す / 消すの二値と、**いつ数え直すか**をここに持つ。
 * 描き直しは repaint で呼び手に返す——描くのはバックエンドの仕事。
 */
export class CaretBlink {
  private timer: ReturnType<typeof setInterval> | null = null;
  private visible = true;

  constructor(private repaint: () => void) {}

  /** いま出す番か */
  get on(): boolean {
    return this.visible;
  }

  /**
   * 状態が来たので数え直す。focus していなければ止める。
   *
   * 打った直後・動かした直後はキャレットを出しておきたいので、
   * 呼ばれるたびに点いた状態から数え直す。間隔が 0 以下なら点滅しない
   */
  sync(focused: boolean, interval: number): void {
    this.stop();
    if (!focused || interval <= 0) return;
    this.timer = setInterval(() => {
      this.visible = !this.visible;
      this.repaint();
    }, interval);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.visible = true;
  }
}
