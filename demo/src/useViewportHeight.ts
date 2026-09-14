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
      document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
    };
    apply();
    // キーボードの出入りは resize、ページごとずれるのは scroll で来る
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
