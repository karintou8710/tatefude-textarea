# canvas-vert-textarea

**組版を自前で持つテキストエリア。縦書きと横書き、canvas と DOM を同じ API で扱う。**

[tatefude](https://github.com/karintou8710/tatefude) は縦書きの WYSIWYG (リッチテキスト)。
こちらはその平文版で、実装は共有していない。

`contenteditable` は使わない。入力は画面に出さない `<textarea>` が受け、
テキスト・選択・履歴・IME はこちらが持つ。**違うのは「どう組んで、どう描くか」だけ。**

| バックエンド | 組み方 | import |
| --- | --- | --- |
| `canvas` | 字を 1 つずつ canvas に置く。行分割・禁則・字の向きを自前で持つ | `canvas-vert-textarea` |
| `dom` | ブラウザの `writing-mode` に組ませて、落ちた位置を Range API で読み返す | `canvas-vert-textarea/dom` |

同じ振る舞いであることは、[ブラウザテスト](packages/core/test/browser/editor.test.ts)を
**2 実装 × 縦横 × 2 エンジン (Chromium / WebKit)** に通して縛っている。

```ts
new CanvasVertTextarea(host, { writingMode: "vertical-rl" });   // 既定
new DomVertTextarea(host, { writingMode: "horizontal-tb" });
```

座標は inline (字の並ぶ向き) と block (行の重なる向き) で持っていて、
物理の x/y に直すのは描く直前だけ。キー操作も論理なので、
組み方を変えても同じコードが動く。

## どちらを使うか

**まず `dom` を試すことを勧める。**

縦組みでいちばん間違えやすいところ — 字の向き (UAX #50)・フォントの縦組み字形 (`vert`)・
禁則 — がブラウザ側で解決される。`canvas` 側はこれを自前のテーブルで近似していて、
実測したところ**半角カタカナ (U+FF66–FF9D) と ± § などを取り違えていた**。
規格を自分で持つのは、地味に間違え続ける仕事になる。

`canvas` を選ぶ理由はこのあたり。

- 原稿用紙のマス目、字ごとの装飾など**レイアウト結果そのものが要る**
- canvas / WebGL アプリの中に埋める
- 印刷・画像出力でブラウザ差を消したい
- 禁則を自前で制御したい (`dom` は `line-break` の strict / loose しか選べない)

## 使う

```sh
pnpm add canvas-vert-textarea
```

```ts
import { CanvasVertTextarea } from "canvas-vert-textarea";
// あるいは
// import { DomVertTextarea } from "canvas-vert-textarea/dom";

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
import { VertTextarea } from "canvas-vert-textarea-react";

function Editor() {
  const [value, setValue] = useState("");
  return (
    <div style={{ display: "grid", height: 480 }}>
      <VertTextarea backend="dom" value={value} onChange={setValue} padding={24} />
    </div>
  );
}
```

`value` を渡すと controlled、渡さなければ `defaultValue` から始まる uncontrolled になる。

## canvas バックエンドの組み方

`dom` バックエンドではここを全部ブラウザに任せるので、以下は `canvas` の話。

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

**Blink の `<textarea>` に合わせてある。** 縦書きでも「下 = 次の行」「右 = 次の文字」と
論理の意味を保ち、物理の向きには合わせない。
実際に縦書きの textarea を隣に置いて同じキーを打ち、offset を突き合わせている
([native.test.ts](packages/core/test/browser/native.test.ts))。

| キー | 動き |
| --- | --- |
| `↑` `↓` | 前の行 / 次の行へ (縦書きなので右 / 左へ動く) |
| `←` `→` | 1 文字戻る / 進む (縦書きなので上 / 下へ動く) |
| `⌥` + `↑` `↓` | 段落の頭 / 末へ |
| `⌥` + `←` `→` | 単語ぶん動く |
| `⌘` + `↑` `↓` | 文頭 / 文末へ |
| `⌘` + `←` `→` | 行頭 / 行末へ |
| `Home` `End` | 行頭 / 行末へ |
| `Shift` + 上記 | 選択を伸ばす |
| `⌘A` / `⌘Z` / `⇧⌘Z` | 全選択 / 取り消し / やり直し |
| ダブルクリック / トリプルクリック | 単語 / 段落を選ぶ |

ホイールと横スワイプで行送り方向に送る (縦書きなので、下に回すと左へ読み進む)。

### わざと合わせていないもの

- `Home` / `End` / `PageUp` / `PageDown` … Blink は縦書きだと**何もしない**。
  使えないままにする理由が無いので、行頭 / 行末と 1 画面ぶんの行移動に割り当てている
- `⌥` + 左右 (単語) … Blink は CJK を 1 文字ずつ刻む。`Intl.Segmenter` の方が日本語に合う

## できないこと

- **canvas バックエンドは字を 1 つずつ測って置く**ので、フォントのカーニングや
  約物の詰め (`palt` / `chws`) が効かない。ラテンの綴りや連続する約物の詰まり方が
  dom バックエンドと少しずれる
- ルビ・縦中横・傍点は持たない。**平文の textarea であって RTE ではない**
  (要るなら [tatefude](https://github.com/karintou8710/tatefude))
- スクロールバーは出ない。送りはホイールと `scrollOffset` から
- 行の詰め (追い込み・字間調整) はしない
- `writing-mode` は `vertical-rl` と `horizontal-tb` だけ。縦書き左→右や RTL には対応しない

## 開発

```sh
pnpm install
pnpm dev          # demo を立てる (2 実装が並ぶ)
pnpm typecheck
pnpm lint
pnpm test         # レイアウトの単体テスト (node)
pnpm --filter canvas-vert-textarea test:browser   # エディタのテスト (chromium)
pnpm build
```

## ライセンス

MIT
