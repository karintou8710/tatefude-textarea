import { useSyncExternalStore } from "react";

// matchMedia は呼ぶたびに新しい MediaQueryList を作る。
// getSnapshot は描画のたびに呼ばれるので、1 つに固定しておく
let media: MediaQueryList | null = null;
const dark = () => (media ??= window.matchMedia("(prefers-color-scheme: dark)"));

function subscribe(onChange: () => void): () => void {
  const query = dark();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** 色は CSS から読めないので、配色を JS 側でも知る必要がある */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => dark().matches,
    () => false,
  );
}
