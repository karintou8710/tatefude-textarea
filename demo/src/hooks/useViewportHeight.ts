import { useEffect } from "react";

/**
 * いま本当に見えている高さを CSS 変数 --app-height に流す。
 *
 * ソフトキーボードは出ても layout viewport を縮めてくれないことがあり、
 * svh / dvh はキーボードのぶんを知らない。visualViewport だけが残りの高さを持っている。
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const apply = () => {
      // ピンチズームでも height は縮む。キーボードのぶんだけ見たいので割り戻す
      const height = viewport.height * viewport.scale;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
    };
    apply();
    // スクロールでは高さが変わらないので、聞くのは resize だけでいい
    viewport.addEventListener("resize", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
