# macOS

## 矢印だけ、わざと合わせていない

- 割り当ては画面で見た向き。縦書きなら `↑↓` が字送り、`←→` が行送り
- Linux / Windows の `<textarea>` と同じ。**macOS の `<textarea>` だけ**、縦書きでも `←→` が字送りのまま
  (矢印が OS のキーバインドから来るため)
- 基準は `test/native.browser.test.ts`。本物を隣に置いて同じキーを打つ。chromium でだけ回る

## 修飾キー

- `accel` = ⌘ または Ctrl。どちらでも受ける
- ⌥ + 矢印 … 単語 / 段落、`accel` + 矢印 … 行端 / 文頭文末
- **未対応**: macOS の `<textarea>` が持つ Emacs 風バインド (Ctrl+A / E / K など)。
  こちらは Ctrl+A を全選択に割り当てているので、ここだけネイティブと食い違う

## WebKit の癖

- **`line-height` を整数に丸める** (17px × 1.8 = 30.6 → 30)。決め打つとキャレットが行番号に比例してずれるので、レイアウトされた行間を実測する
- **`vertical-rl` の `scrollLeft` の符号**。`backend/scroll.ts` は「Blink は負・WebKit は正」として距離に均しているが、
  実測ではデスクトップの両エンジンとも負だった → [textarea.md](textarea.md)
- **`pointerdown` の `preventDefault` では合成マウスイベントが止まらない**。`mousedown` と `touchend` の側で止める
- **縦書きの `<textarea>` は矢印移動が壊れている** → [textarea.md](textarea.md)。
  `contenteditable` のほうはまだ測っていない

## トラックパッド

ホイールは 2 軸同時に来る。縦書きは `deltaY - deltaX` を送りに使う。
