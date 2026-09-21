# tatefude-textarea

**縦書きと横書きのテキストエリア。組版はブラウザに任せ、編集を自前で持つ。**

**[触ってみる](https://karintou8710.github.io/tatefude-textarea/)**

Safari は Mac も iOS も、縦書きの `<textarea>` と `contenteditable` が結構壊れている。
直るのを待つにも、こちらから直しにいくにも、相当な時間がかかりそうだった。

`contenteditable` は使わない。入力は画面に出さない `<textarea>` が受け、
テキスト・選択・履歴・IME はこちらが持つ。レイアウトはブラウザの `writing-mode` に任せ、
落ちた位置を Range API で読み返す。

## 使う

```sh
pnpm add tatefude-textarea
```

```ts
import { DomTextarea } from "tatefude-textarea";

const editor = new DomTextarea(document.getElementById("editor")!, {
  value: "吾輩は猫である。名前はまだ無い。",
  placeholder: "ここに書く",
  className: "editor",
  onChange: (value) => console.log(value),
});

editor.focus();
```

**寸法とレイアウトは CSS に書く。**字の大きさ・行送り・余白・禁則は、置き場の要素に
当てたスタイルから読む。`className` を渡すと、元から付いているクラスは残したまま足す。

```css
.editor {
  font: 20px/1.8 "Hiragino Mincho ProN", serif;
  padding: 24px;
  line-break: strict; /* 禁則。切るなら loose */
}
```

**色だけは `theme` で渡す。**選択も変換中の下線も自前の要素なので、
`::selection` も `::placeholder` も効かない。CSS 変数で受けると型が付かない。

```ts
editor.setOptions({ theme: { text: "#1a1a1a", selection: "#b4d5fe" } });
```

CSS には「変わった」を知らせる口が無い。字の大きさや余白を CSS で変えたら
`editor.refresh()` を呼ぶ。コンテナの寸法だけなら `ResizeObserver` が拾うので要らない。

置き場の要素にはサイズが要る。中身は `position: absolute` で敷き詰めるので、
**高さが 0 に潰れる書き方 (flex アイテムの子に `height: 100%` など) だと何も出ない。**

React なら:

```sh
pnpm add tatefude-textarea tatefude-textarea-react
```

```tsx
import { Textarea } from "tatefude-textarea-react";

function Editor() {
  const [value, setValue] = useState("");
  return (
    <div style={{ display: "grid", height: 480 }}>
      <Textarea className="editor" value={value} onChange={setValue} />
    </div>
  );
}
```

`value` を渡すと controlled、渡さなければ `defaultValue` から始まる uncontrolled になる。
描画のたびに CSS を読み直すので `refresh()` は要らない。色は core と同じく `theme` prop で渡す。

## キー操作

**矢印は画面で見た向きのまま動く。** 縦書きは字が下へ並んで行が左へ重なるので、
字送りが `↑` `↓`、行送りが `←` `→` になる (横書きはその逆)。
これは Linux / Windows の `<textarea>` と同じ割り当て。
macOS だけは矢印が OS のキーバインドから来るため、縦書きでも `←` `→` が字送りのままで、
**そこだけ合わせていない。**
着く先は合わせてあり、縦書きの textarea を隣に置いて同じ意味のキーを打ち、offset を突き合わせている
([native.browser.test.ts](packages/core/test/native.browser.test.ts))。

以下は縦書きのとき。横書きでは `↑` `↓` と `←` `→` が入れ替わる。

| キー | 動き |
| --- | --- |
| `↑` `↓` | 1 文字戻る / 進む (字は下へ並ぶ) |
| `←` `→` | 次の行 / 前の行へ (行は左へ重なる) |
| `⌥` + `↑` `↓` | 単語ぶん動く |
| `⌥` + `←` `→` | 段落の末 / 頭へ |
| `⌘` + `↑` `↓` | 行頭 / 行末へ |
| `⌘` + `←` `→` | 文末 / 文頭へ |
| `Home` `End` | 行頭 / 行末へ |
| `Shift` + 上記 | 選択を伸ばす |
| `⌘A` / `⌘Z` / `⇧⌘Z` | 全選択 / 取り消し / やり直し |
| ダブルクリック / トリプルクリック | 単語 / 段落を選ぶ |

ホイールとタッチのパンで行送り方向に送る (縦書きなので、下に回すと左へ読み進む)。

### わざと合わせていないもの

- `Home` / `End` / `PageUp` / `PageDown` … Blink は縦書きだと**何もしない**。
  使えないままにする理由が無いので、行頭 / 行末と 1 画面ぶんの行移動に割り当てている
- `⌥` + 左右 (単語) … Blink は CJK を 1 文字ずつ刻む。`Intl.Segmenter` の方が日本語に合う

## できないこと

- ルビ・縦中横・傍点は持たない。**平文の textarea であって RTE ではない**
- 行の詰め (追い込み・字間調整) はしない
- `writing-mode` は `vertical-rl` と `horizontal-tb` だけ。縦書き左→右や RTL には対応しない

## 開発

```sh
pnpm install
pnpm dev          # demo を立てる
pnpm typecheck
pnpm lint
pnpm test         # 単体テスト (node)
pnpm --filter tatefude-textarea test:browser   # エディタのテスト (chromium / webkit)
pnpm build
```

## ライセンス

MIT
