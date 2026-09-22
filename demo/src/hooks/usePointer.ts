import { useSyncExternalStore } from "react";

// matchMedia は呼ぶたびに新しい MediaQueryList を作る。
// getSnapshot は描画のたびに呼ばれるので、1 つに固定しておく
let media: MediaQueryList | null = null;
const coarse = () => (media ??= window.matchMedia("(pointer: coarse)"));

function subscribe(onChange: () => void): () => void {
  const query = coarse();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * 指で触る機器か。
 *
 * PC には ⌘C / ⌘X / ⌘V があるので編集メニューは要らない。
 * 出すのは指のときだけで、ハンドルを出す条件と揃う。
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => coarse().matches,
    () => false,
  );
}
