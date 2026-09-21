# WebKit の縦書き編集のバグ

手元の WebKit のソース (`~/works/WebKit`) から拾った FIXME と、Bugzilla の関連チケット。
**どれも状態は未確認**。手元のソースに残っているコメントは、少なくともそこに回避が入っている証拠。

## ソースに残っている FIXME

| 場所 | 内容 | 効いてくるところ |
| --- | --- | --- |
| `rendering/RenderElement.cpp:551` | **「レイアウト後の再描画が flipped writing mode (主に vertical-rl) で壊れている」** ([b/70762](https://bugs.webkit.org/show_bug.cgi?id=70762))。その場しのぎの repaint が入っている | **削除しても画面に反映されない** → [contenteditable.md](contenteditable.md) |
| `WebKit/UIProcess/ios/WKContentViewInteraction.mm:12586` | 行の当たり判定を y 方向にだけ広げている。「縦書きを考慮すべきでは？」 | iOS のテキスト操作 (キャレットを掴む・選ぶ) |
| `rendering/TextBoxPainter.cpp:926` | `underlineOffsetForTextBoxPainting` が vertical-lr で誤った値を返す | **IME の変換下線** |
| `rendering/TextBoxPainter.cpp:496` | 「vertical bottom to top を扱う必要があるか」 | 下線・打ち消し線 |
| `rendering/cocoa/RenderThemeCocoa.mm:2836` | 縦書きではテキストを block 始端からもっと内側に入れるべき | フォーム部品の見た目 |
| `rendering/RenderListBox.cpp:621` | 縦書きと flipped block direction に未対応 | `<select>` |

## Bugzilla

| | |
| --- | --- |
| [70762](https://bugs.webkit.org/show_bug.cgi?id=70762) | flipped writing mode の再描画 (上の FIXME が指している) |
| [103621](https://bugs.webkit.org/show_bug.cgi?id=103621) | `<br>` を含む contenteditable のキャレットが縦書きで誤って描かれる |
| [117228](https://bugs.webkit.org/show_bug.cgi?id=117228) | `writing-mode: vertical-lr` が textarea で効かない |
| [70211](https://bugs.webkit.org/show_bug.cgi?id=70211) | 縦書きのフォーム部品の初期実装 |
| [71189](https://bugs.webkit.org/show_bug.cgi?id=71189) | `unicode-bidi: -webkit-plaintext` が textarea のキャレットに効くべき |
| [62833](https://bugs.webkit.org/show_bug.cgi?id=62833) | **縦書きでの矢印キーの割り当て**。`editing/EditorCommand.cpp` の `logicalMoveForArrowKey` がこの ID を引いていて、実装は入っている |

## こちらの実測との対応

| 測ったこと | 対応しそうなもの |
| --- | --- |
| キャレットが列幅の 1/3 しかない → [textarea.md](textarea.md) | 見当たらない。**未報告かもしれない** |
| **`↑` `↓` が隣の列の末尾に飛ぶ** (行内位置が引き継がれない) → [textarea.md](textarea.md) | 矢印の割り当て自体は [62833](https://bugs.webkit.org/show_bug.cgi?id=62833) にあるが、**この着地点の話は見当たらない**。別件の可能性 |
| 削除が反映されない (当時) → [contenteditable.md](contenteditable.md) | `RenderElement.cpp:551` / b/70762 |
| focus があるとネイティブ選択が始まらない → [selection.md](selection.md) | 見当たらない。縦書きに限らない話の可能性 |

## 未確認

- 各チケットが open か fixed か
- 上の「未報告かもしれない」2 つが、本当に未報告か
