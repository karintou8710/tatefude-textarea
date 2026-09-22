# テスト

**できるだけヘッドレスで。** 実機は最後に回す。

| | どこで | 頻度 | 状態 |
| --- | --- | --- | --- |
| ① playwright (chromium / webkit) | ubuntu | 毎 PR | 動いている |
| ② iOS シミュレータの Safari | macOS runner (public repo なので無料) | 手動 / nightly | 未着手 |
| ③ 実機 | クラウド実機 or self-hosted | リリース前・iOS 更新時 | 未着手 |

## ①で捕まらないもの

**デスクトップの WebKit にキーボードは無い。** [research/ios.md](research/ios.md) の 4 つは CI で 1 つも落ちなかった。
コンテナの縮みは `container.style.height` を書けば再現できるので、**そこまではヘッドレスに落とせる**。
落とせないのは visualViewport・ focus の奪い合い・合成マウスイベントの有無。

## ②のやり方

- **Appium (XCUITest + Safari)** … WebDriver なのでアサーションが普通に書ける。セットアップは重い
- **`simctl` + 座標タップ + ページからログを POST** … セットアップ不要。壊れやすい

ソフトキーボードを出す: `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false`

## ③ 実機のチェックリスト

1. 下のほうをタップしてキーボードを開く → **タップした列が動かない**
2. 書いてからキーボードを閉じる → **読んでいた場所が動かない**
3. スワイプしてからタップする → **指の下にキャレットが来る**
4. タップしてキーボードが開く → **一瞬で閉じない**
5. 長押し / ダブルタップ / トリプルタップ / ハンドルを引く / メニュー
6. 変換して確定する

確認した iOS のバージョンを残す。挙動は年ごとに変わる。
