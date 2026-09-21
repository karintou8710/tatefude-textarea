import { useEffect, useState } from "react";

/** これだけ縮んだらキーボードが出たとみなす (CSS px) */
const THRESHOLD = 150;

/**
 * ソフトキーボードが出ているか。
 *
 * 開いたことを直接知らせてくれる口は無いので、visual viewport が縮んだかで測る。
 * layout viewport を縮めるかはブラウザに依る (iOS は縮めない) が、
 * visual viewport はどちらでも縮む。
 *
 * PC では縮まないので、常に false になる。
 */
export function useSoftKeyboard(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    // 出ていないときの高さ。回転で変わるので、幅が変わったら測り直す
    let width = viewport.width;
    let tallest = 0;

    const apply = () => {
      // ピンチズームでも height は縮む。キーボードのぶんだけ見たいので割り戻す
      const height = viewport.height * viewport.scale;
      if (viewport.width !== width) {
        width = viewport.width;
        tallest = 0;
      }
      tallest = Math.max(tallest, height);
      setOpen(tallest - height > THRESHOLD);
    };
    apply();
    viewport.addEventListener("resize", apply);
    return () => viewport.removeEventListener("resize", apply);
  }, []);

  return open;
}
