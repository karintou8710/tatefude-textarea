/**
 * 画面の側の状態。本文とは別に動く。
 *
 * 編集の状態 (`EditState`) と同じく、作り直すだけで書き換えない。
 * どれも外へ知らせるものではないので、動いたら描き直すだけ。
 */
export interface ScreenState {
  /** 隠し入力が focus を持っているか */
  readonly focused: boolean;
  /** 選択の端にハンドルを出すか。指で触ったときだけ立てる */
  readonly handles: boolean;
}

export const newScreenState: ScreenState = {
  focused: false,
  handles: false,
};

export function setFocused(screen: ScreenState, focused: boolean): ScreenState {
  if (screen.focused === focused) return screen;
  // focus を失ったらハンドルも引っ込める
  return { ...screen, focused, handles: focused && screen.handles };
}

/** ハンドルの出し入れ。指で触ったら出し、打ったら引っ込める */
export function showHandles(screen: ScreenState, handles: boolean): ScreenState {
  if (screen.handles === handles) return screen;
  return { ...screen, handles };
}
