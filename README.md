# canvas-vert-textarea

**canvas に自前で組む縦書きのテキストエリア。**

`writing-mode: vertical-rl` を当てた DOM ではなく、字の 1 つずつを canvas に置いて縦組みを作る。
入力は画面に出さない `<textarea>` が受けるので、IME もクリップボードもブラウザの仕組みに乗る。

- `canvas-vert-textarea` … 素の DOM で使うコア
- `canvas-vert-textarea-react` … React アダプタ

## なぜ canvas か

DOM の `writing-mode: vertical-rl` は、**どこで折り返したか・どの字がどこに落ちたかをこちらから見られない**。
禁則の効き方も字の向きもブラウザ任せで、縦中横やルビを足そうとした途端に手が出せなくなる。

canvas なら行分割から字の置き場所まで全部こちらが持つ。
代わりに、DOM が無料でくれていたもの — キャレット・選択・IME・スクロール — を自分で書くことになる。
このライブラリはその引き受けたぶんを実装している。

## 使う

```sh
pnpm add canvas-vert-textarea
```

```ts
import { CanvasVertTextarea } from "canvas-vert-textarea";

const editor = new CanvasVertTextarea(document.getElementById("editor")!, {
  value: "吾輩は猫である。名前はまだ無い。",
  placeholder: "ここに書く",
  font: { size: 20, lineHeight: 1.8 },
  padding: 24,
  onChange: (value) => console.log(value),
});

editor.focus();
```

置き場の要素にはサイズが要る。中身は `position: absolute` で敷き詰めるので、
**高さが 0 に潰れる書き方 (flex アイテムの子に `height: 100%` など) だと何も出ない。**

React なら:

```sh
pnpm add canvas-vert-textarea canvas-vert-textarea-react
```

```tsx
import { CanvasVertTextarea } from "canvas-vert-textarea-react";

function Editor() {
  const [value, setValue] = useState("");
  return (
    <div style={{ display: "grid", height: 480 }}>
      <CanvasVertTextarea value={value} onChange={setValue} padding={24} />
    </div>
  );
}
```

`value` を渡すと controlled、渡さなければ `defaultValue` から始まる uncontrolled になる。

## 縦書きの組み方

### 字の向き

UAX #50 (Unicode Vertical Text Layout) の分類を、canvas で再現できる 3 つに潰している。

| | 例 | 置き方 | 送り量 |
| --- | --- | --- | --- |
| `upright` | 漢字・仮名・全角英数 | そのまま正立 | 1em |
| `rotate` | ラテン文字・数字・括弧・ー・… | 時計回りに 90 度倒す | 横書きでの字幅 |
| `corner` | 、。 | 正立させて字面を右上へ寄せる | 1em |

括弧や長音を「倒す」で済ませているのは、横書きの字形を 90 度回すと縦組みの字形になるため。
**フォントが持つ縦組み字形 (`vert` / `vrt2` テーブル) は canvas から引けない**ので、
小書き仮名だけは平行移動で近似している (`smallKanaShift`、既定 0.08em、0 で切れる)。

### 禁則処理

追い出し (次の行へ送る) だけで直す。追い込みはしない。

- 行頭禁則 … `、。」）！？` 小書き仮名 `ー…` など
- 行末禁則 … `「（【` など
- ラテン語の綴りは途中で割らない

戻す量には上限があり、行が空になるくらいなら諦めてそのまま切る。
`kinsoku: false` で全部切れる。

### キャレットと選択

縦書きなのでキャレットは横棒、選択範囲は列を塗る矩形になる。
折り返しの境目は前の行の末尾と次の行の先頭が同じオフセットになるので、
`preferEnd` (affinity) でどちら側に着けるかを持っている。進んで着いたら前の行、戻って着いたら次の行。

## キー操作

行の中が上下、行送りが左右になる。

| キー | 動き |
| --- | --- |
| `↑` `↓` | 行の中を戻る / 進む |
| `←` `→` | 次の行 / 前の行へ |
| `Option` + `↑` `↓` | 単語ぶん動く |
| `⌘` + `↑` `↓` | 行頭 / 行末へ |
| `⌘` + `→` `←` | 文頭 / 文末へ |
| `Shift` + 上記 | 選択を伸ばす |
| `⌘A` / `⌘Z` / `⇧⌘Z` | 全選択 / 取り消し / やり直し |
| ダブルクリック / トリプルクリック | 単語 / 段落を選ぶ |

ホイールと横スワイプで行送り方向に送る (縦書きなので、下に回すと左へ読み進む)。

## できないこと

- ルビ・縦中横・傍点は持たない。**平文の textarea であって RTE ではない**
  (縦書きの WYSIWYG が要るなら [tatefude](https://github.com/karintou8710/tatefude))
- スクロールバーは出ない。送りはホイールと `scrollOffset` から
- 行の詰め (追い込み・字間調整) はしない
- `writing-mode` は `vertical-rl` のみ

## 開発

```sh
pnpm install
pnpm dev          # demo を立てる
pnpm typecheck
pnpm lint
pnpm test         # レイアウトの単体テスト (node)
pnpm --filter canvas-vert-textarea test:browser   # エディタのテスト (chromium)
pnpm build
```

## ライセンス

MIT
