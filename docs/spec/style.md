# 見た目

**寸法とレイアウトは CSS、色は props。**

## CSS から読む

コンテナの計算スタイルから引く。`className` は、元から付いているクラスを残して足す。

| | |
| --- | --- |
| `font` | 字の送り量 |
| `line-height` | 行送り。**実際に組まれた間隔を測り直す** |
| `padding` | 余白 |
| `line-break` | 禁則 |

CSS には変わったことを知らせる口が無い。変えた側が `refresh()` を呼ぶ。

## props で受ける

| | |
| --- | --- |
| `theme` | `background` / `text` / `placeholder` / `caret` / `selection` / `selectionInactive` / `composition` / `compositionActive` |
| `writingMode` | `vertical-rl` か `horizontal-tb` |

内部の要素にクラス名は付けない → [../decisions/0003](../decisions/0003-キャレットを自前で描く.md)

## コンテナ

`position` が `static` なら `relative` を当て、`overflow: hidden` にする。
中身は絶対配置で敷き詰めるので、**高さが 0 に潰れる書き方だと何も出ない。**
