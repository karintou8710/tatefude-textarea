/**
 * コンテナそのものに当てるもの。
 *
 * エディタは中身を絶対配置で重ねるので、コンテナには位置の基準と切り落としが要る。
 * クラスは字の大きさ・余白・禁則を CSS から読ませるための口で、
 * 自分で足したぶんだけを覚えておき、元から付いていたものは触らない。
 */
export class ContainerStyle {
  private own: string[] = [];

  constructor(private container: HTMLElement) {
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.style.overflow = "hidden";
  }

  setClassName(className: string): void {
    const next = className.split(/\s+/).filter(Boolean);
    for (const name of this.own) {
      if (!next.includes(name)) this.container.classList.remove(name);
    }
    for (const name of next) this.container.classList.add(name);
    this.own = next;
  }

  /** 後片付け。足したクラスを外す */
  destroy(): void {
    this.setClassName("");
  }
}
