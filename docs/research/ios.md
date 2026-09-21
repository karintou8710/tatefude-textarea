# iOS

Safari (iOS) でだけ出たもの。すべて実機で確認して直した。

## 踏んだもの

| 症状 | 原因 | 直し方 |
| --- | --- | --- |
| 叩いた列と別の列にキャレットが行く | focus を先に入れると、その時点の古いキャレットを見せる送りが走る | 測る → 置く → focus の順にする |
| キーボードが開いた瞬間に列が飛ぶ | 送れる上限 (spacer) を直す前に送っていた | `syncGeometry` で 寸法 → レイアウト → 上限 を固定 |
| 閉じると読んでいた場所ごと飛ぶ | focus が無いと追従を丸ごと見送っていた | 戻す先があれば focus が無くても戻す |
| 一瞬開いてすぐ閉じる | ① コンテナが縮んでも隠し入力を置き直さない ② touchend の後に届く合成 mousedown がコンテナの外に落ちて focus を奪う | ① レイアウトで `moveTo` ② touchend で `preventDefault` |

## 調べ方

Mac に繋げば Web Inspector で見られるが、何度も試すには重い。
ページから開発サーバへログを POST して、ファイルに落として読んだ (vite の `configureServer` に受け口を足す)。

見たもの: `focusin` / `focusout`、`visualViewport` の高さ、隠し入力の画面 y、
ResizeObserver の発火、キャレットの列 (レイアウト前 → 戻したあと → `ensureVisible` 後)。

## ヘッドレスで捕まらないもの

- **デスクトップの WebKit にキーボードは無い**。上の 4 つは CI で 1 つも落ちなかった
- iOS シミュレータの Safari なら再現する
  (`defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false` でソフトキーボードが出る)
- シミュレータでも残るのはタイミング依存のもの。キーボードのアニメーションの長さが実機と違う
