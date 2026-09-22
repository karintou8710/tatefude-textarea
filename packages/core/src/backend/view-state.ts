import type { ViewContent } from "../state/query";
import type { ScreenState } from "../state/screen";
import type { ViewState } from "./backend";

/**
 * 状態からバックエンドに渡す 1 枚を組む。**状態と描画の継ぎ目。**
 *
 * 「変換中は選択とハンドルを出さない」「選択が伸びている間はキャレットを出さない」
 * といった決まりはここだけに置く。純関数なので表で縛れる。
 *
 * `placeholder` は状態ではなく options から来るので、別に受ける。
 */
export function buildViewState(
  content: ViewContent,
  screen: ScreenState,
  placeholder: string,
): ViewState {
  return {
    text: content.text,
    // 変換中は選択を出さない。預かった文字列が選択の中に入るわけではない
    selection: content.composing ? { start: 0, end: 0 } : content.selection,
    caret: content.caret,
    // 選択が伸びている間は出さない。textarea もそうなっている。
    // 点滅で「いま出す番か」を掛けるのは描く側 (backend)
    caretVisible: content.collapsed,
    focused: screen.focused,
    handles: screen.handles && !content.composing,
    composition: content.composition,
    placeholder: content.empty && !content.composing && placeholder ? placeholder : null,
  };
}
