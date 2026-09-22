# 公開 API

読みは `state`、動かすのは `commands`、動くかは `can`。

## state

読むだけの写し。触っても本文は動かない。

| | |
| --- | --- |
| `value` | 本文 |
| `selection` | `{ anchor, head }`。anchor が掴んだ側 |
| `selectedText` | 選択の文字列 |
| `composing` | 変換中か |

## 矩形とスクロール

レイアウトに聞くもの。`state` とは出どころが違う。

| | |
| --- | --- |
| `caretRect` / `selectionRect` | コンテナ基準の矩形。選択が無ければ `null` |
| `scrollOffset` | スクロール量 (読み書き)。向きに依らず 0 以上 |

## commands

`setValue` / `setSelection` / `selectAll` / `insertText` / `cut` / `undo` / `redo`。
DOM の focus は本文を動かさないので `focus()` / `blur()` のまま置く。

| | |
| --- | --- |
| `setValue` | 履歴を捨てる。`keepHistory` で残す |
| `setValue` | `onChange` を呼ばない。`notify` で呼ぶ |
| `cut` | 切り取った文字列を返す |
| `readOnly` / `disabled` | 本文は動かない。選択は動く |

## can

`commands` と同じ引数を取り、**「許されているか」ではなく「動くか」を返す。**

| | |
| --- | --- |
| いまと同じ本文の `setValue` | `false` |
| いまと同じ場所の `setSelection` | `true` (打鍵のまとまりが切れる) |

## コールバック

| | いつ |
| --- | --- |
| `onChange` | 本文が変わったとき |
| `onSelectionChange` | 選択が変わったとき。変換中の字の伸び縮みでは呼ばない |
| `onFocus` / `onBlur` | 隠し入力の focus |

## 生成と破棄

| | |
| --- | --- |
| `new DomTextarea(container, init)` | 先頭は必ずコンテナ |
| `setOptions(options)` | 渡したものだけ重ねる (theme も) |
| `refresh()` | CSS を読み直してレイアウトし直す |
| `destroy()` | 足した要素とクラスを外す |

コンテナの寸法だけなら `ResizeObserver` が拾うので `refresh()` は要らない。
