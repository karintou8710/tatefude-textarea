# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コードコメント

- WHY だけ書く。コードを読めば分かる WHAT は書かない。
- 短く、シンプルに。

## 置き場所

**4 つの層に分ける**。依存は下向きだけで、上の層を見てはいけない。

```
① input   … 入力を解釈する。イベントを「何をするか」に変える
② edit    … 編集操作。状態を変えるのが目的
③ state   … 状態。作り直すだけで、書き換えない
④ backend … 描画として反映する
```

- `packages/core/src/input` … ① キーの割り当て (`keymap.ts`)、隠し入力 (`hidden-input.ts`)、
  指とマウス (`pointer.ts` + `gesture.ts`)。解釈した結果は `edit/` の操作を呼ぶ。
  **判定と配線を分ける**。何をタップしたことにするかは `gesture.ts` が純粋に決め
  (出来事を受けて、新しい状態と「やること」を返す)、`pointer.ts` は DOM の都合だけ持つ
  ——合成イベントの打ち消し、ポインタの捕捉、タイマ。閾値は判定の側に閉じるので node で縛れる。
- `packages/core/src/edit` … ② 編集操作。**1 つずつ関数で書く。**
  第 1 引数は `EditState`、戻り値は `Result` (新しい state と `Changed`)。
  打つ・消す・切り取る (`text.ts`)、選ぶ・動かす (`selection.ts`)、変換 (`compose.ts`)、
  指示の振り分け (`command.ts`)。`Command` 型もここが持つ——キーの割り当ては
  「編集操作への指示」を作る側だから。
- `packages/core/src/state` … ③ 状態と、そこから引き出すもの。
  編集の状態 (`edit.ts`)、画面の状態 (`screen.ts`)、戻せる場所 (`history.ts`)、
  変換中の字 (`composition.ts`)、引き出すもの (`query.ts`)。
  `interface` と関数だけで、クラスは持たない。
- `packages/core/src/backend` … ④ レイアウトと描画。`view-state.ts` が状態と描画の継ぎ目で、
  `blink.ts` が点滅を持ち、`container.ts` がコンテナに当てる。`backend.ts` が実装の境界。
  **点滅は描く側の都合**なので、状態にも繋ぐ側にも出さない。`show` が来たら数え直す。
- `packages/core/src/layout.ts` … **層の外**。レイアウトへの問い合わせ口。
  行を移る操作と、クリックした場所を数える受け口は「行の切れ目がどこか」を知らないと決められない。
  その問い合わせだけを層の外に置いて、②① が描画の実装に依らないようにしてある。
  **口は役ごとに割る。まとめた型は作らない。**
  `Lines` (②が聞く。行を移る) / `Hits` (①が聞く。クリックした場所) /
  `Measures` (数で答える。矩形と寸法) / `Scroller` (スクロール)。
  1 つの広い口にすると②が `caretRect` を触れてしまう——**使っていないものが
  型から見えない状態を保つ。**束ねるのは実装側だけ (`Backend extends …`)。
- `packages/core/src/text` … **層の外**。文字列の純粋な計算。
  キャレットの型 (`caret.ts`)、書記素・語の区切り (`segment.ts`)、
  改行の揃え (`normalize.ts`)、語・段落の範囲 (`range.ts`)、1 つぶん動く (`move.ts`)。
- `packages/core/src/textarea.ts` … 4 つの層を繋ぐだけ。公開 API と、
  動いたあとの後始末 (`apply`)。**自分では何も計算しない。**
  受け取るのは `(container, init)` の 2 つで、**先頭は必ず container**。
  コンテナだけは袋に入れない——誰の上に置くかは、options ではなく置き場所だから。
  残りは `TextareaInit` に名前で入れる。並び順で決めると、増えたときに読み手が数えることになる。
  **`TextareaInit` は `TextareaOptions` と型を分ける**。backend は生成時に凍るので、
  `setOptions` に渡せてはいけない。
  **渡すのは backend だけ**。隠し入力と指は container と backend から機械的に決まるので、
  ここで作る。
- `packages/core/src/dom.ts` / `canvas.ts` … 入口。**どのレイアウトで組むかを選ぶだけ。**
  backend を 1 つ作って `Textarea` に渡すだけ。
  **層より上に置く**——`backend/` の中に置くと
  `backend/ → textarea.ts → backend/` の往復ができてしまう。
- `packages/core/src/backend/scroll.ts` … 両バックエンドが使う。
  `vertical-rl` の `scrollLeft` は Blink が負・WebKit が正へ動くので、ここで距離に均す。
- `packages/core/src/backend/canvas` … 字を 1 つずつ canvas に置く実装。**公開していない。**
  見た目を数値で要求するので、CSS に寄せた公開 API からは切り離して
  `canvas/style.ts` に凍らせてある。
  **canvas 経路でしか使わないものはここに置く。** 外から参照しているものがあれば、
  それは共有すべきか置き場所が違うかのどちらか。
  レイアウト (`layout.ts`, `geometry.ts`, `char-class.ts`, `measure.ts`, `movement.ts`) は
  canvas を触らないので node のテストで回せる。
- `packages/core/src/backend/dom` … writing-mode にレイアウトさせる実装。
  組版はブラウザがやるので、こちらは Range で読み返すだけ。
  どこにキャレットが立つかは `geometry.ts` (折り返しの境目・二分探索・行末のぶら下がり)、
  縦横の入れ替えは `axis.ts`、要素と CSS は `styles.ts`、重ねる層は `renderer.ts`。
  `geometry.ts` と `axis.ts` は DOM を触らないので node のテストで回せる
  (`test/fakes/content.ts` に矩形だけ答えさせる)。
- **両バックエンドは同じ名前で並べる**。`backend.ts` が繋ぎ、`geometry.ts` が位置を引き、
  `renderer.ts` が描き、`scroller.ts` がスクロールさせる。
  canvas だけが `layout.ts` と `measure.ts` を持つ——自分で組版するから。
  **この差だけが残るようにしておく。**
- `packages/react` … core を包むだけ。ロジックを持たせない。

**バックエンドを 1 つ消したときに何が残るかが、そのまま見えるようにしておく。**
`src/backend/dom` か `src/backend/canvas` を消しても、①②③ と `layout.ts` は何も変わらない。

**往復と循環を作らない**。辺の向きはこれだけ。迷ったら数えて確かめる。

```
input → edit → state → text
backend → state → text        (描画は状態を読むだけ。上は見ない)
② → Lines,  ① → Hits,  繋ぐ側 → Measures + Scroller + Painter
④ → 全部を実装                 (口は layout.ts。聞く側と実装側が型の上で会う)
layout.ts → text
textarea.ts → ①②③④            (繋ぐ側だけが全部を見る)
dom.ts / canvas.ts → textarea.ts + backend   (入口)
全員 → types.ts               (葉。公開の型とオプション。ここから出る辺は無い)
```

**辺は数えて確かめる**。いまは循環ゼロで、トポロジカル順に一列に並ぶ。
`text/` と `types.ts` が葉で、`index.ts` が根。

**読む口と動かす口を分ける**。読みは `textarea.state` (`TextareaState`) 1 つから。
読むだけの写しで、触っても本文は動かない。動かすのは `textarea.commands` で、
**外から動かす口はここに全部集める** (`setValue` / `setSelection` / `selectAll` /
`insertText` / `cut` / `undo` / `redo`)。
`value` や `undo` を `Textarea` に平置きしない。
`commands` が持つのは操作そのものではなく、`edit/` の操作と `apply` の繋ぎ——
**②(操作) ではなく `textarea.ts`(繋ぐ側) の一部**で、判断は持たない。
DOM の focus は本文を動かさないので `commands` には入れず、`focus()` / `blur()` のまま置く。
react の `TextareaHandle` も同じ形に揃える。

**「できるか」は state に持たず、操作に聞く**。`canUndo: boolean` のようなフィールドを
`TextareaState` に置かない。state は**本文がいまどうなっているか**を答えるもので、
「呼べるか」は操作の数だけ増えていく別の問いだから。
聞く口は `textarea.can` で、引数は `commands` と同じ (`can.undo()` / `can.insertText("あ")`)。
`edit/` の操作は副作用を持たないので、**走らせて `changed` を見るだけで答えが出る**
——判断を 2 度書かずに済む。Tiptap の `editor.can()` と同じ考えで、
あちらは `dispatch` を渡さないことで同じ状態を作っている。

**`commands` と `can` は 1 つの表から導く**。`textarea.ts` の `ops` に操作を 1 つ並べれば、
`commands` (やる) と `can` (動くか) の両方がそこから出る。**判断が置かれるのは `ops` だけ。**
`commands` に残るのは副作用の段取り (通知するか・ハンドルを引っ込めるか・何を返すか) で、
`can` は `changed !== null` に読み替えるだけ。
足し忘れは型が止める——`TextareaCan` は `TextareaCommands` から導いてある。

**`can` が答えるのは「許されているか」ではなく「動くか」**。いまと同じ本文を渡した
`setValue` は false になり、同じ場所を指す `setSelection` は true になる
(打鍵のまとまりを切るので、state が動く)。この約束を崩さない。

**公開するのは使うためのものだけ**。`src/index.ts` に出すと消せなくなる。
レイアウトの中身は出さない。入口は 1 つ (`tatefude-textarea`)。サブパスは切らない。

**内側の繋ぎを公開 API に出さない**。`Backend` / `Input` / `Pointer` / `TextareaInit` は
組み立ての都合で、外から渡す相手が居ない。テストは `src/` を直に import するので、
`index.ts` に出す理由も無い。出すと**誰も使わない型を永久に約束する**ことになる。
`Textarea` は型としてだけ出す (react が握るため)。組むのは `DomTextarea` から。
**別のレイアウトを足すのもこのリポジトリの中の仕事**——canvas がそうなっている。

**寸法とレイアウトは CSS、色は props**。字の大きさ・行送り・余白・禁則は container の
計算スタイルから読む (`className` でも当てられる)。色だけは `theme` で受ける——
選択も変換中の下線も自前の要素で `::selection` が効かず、canvas は値そのものを要り、
CSS 変数だと型が付かないため。
`writingMode` は CSS の `writing-mode` と同じものだが、矢印がどちらへ動くかを
決める振る舞いなので props で受ける。
CSS には変更を知らせる口が無いので、変えた側が `refresh()` を呼ぶ。

**内部の要素に名前を付けない**。クラス名で色を受けると、要素の並びがそのまま
公開契約になる。色は `theme` で受けて、内側でどう描くかは外から見えないままにする。

**差し替える相手が居ない口は作らない**。`Backend` だけが本当に変わる (dom / canvas) ので、
`Textarea` が受けるのはこれだけ。隠し入力と指は実装が 1 つずつしか無いので、
`textarea.ts` が直に作る。`Input` / `Pointer` の `interface` は残してあるが、
**差し替えるためではなく、繋ぐ側が何に依っているかを見せるため**の型。

**テストのために口を開けない**。組み立て (`apply` の順・通知の条件・`destroy`) は
フェイクバックエンド + 本物の隠し入力で縛る (`test/textarea.browser.test.ts`)。
ブラウザなら本物が動くので、入力を差し替える口は要らない。
順番そのものが覗けないものは、**着いた場所**で縛る
(「描き直してから隠し入力を置く」は、隠し入力がいまのキャレットに乗っていることで見る)。

**描き直しと通知は `textarea.ts` の 1 箇所 (`applyChange`)**。部品は画面を触らず、
「何が動いたか」(`Changed`: `edit` / `selection` / `view` / `null`) を返すだけにする。
`TextDocument` が変わったかどうかを返すのと同じ作法で、
どこで描き直しているかを追える状態に保つ。
**state は作り直す。書き換えない**。`EditState` は `readonly` の値で、操作は
新しいものを返す。差し替えるのは `textarea.ts` の `apply` 1 箇所だけ
(履歴のまとまりを切るときだけ例外——本文も選択も動かないので通さない)。
こうしておくと「変えたのに描き直していない」が構造的に起きない。

**副作用の有無で名前を分ける**。`edit/` の関数は副作用を持たない——state を受けて
新しい state を返すだけで、画面も外も触らない。副作用を持つのは `textarea.commands` の側で、
呼べば画面が変わり通知が飛ぶ。**どちらを握っているかが名前で分かる状態を崩さない。**

**`edit/` `state/` `text/` は外の世界を読まない**。`Date.now()` も乱数も DOM も見ない。
例外は履歴のまとまりの判定 1 箇所だけ (`history.push` の `now`)。引数で受けられるので、
テストは `vi.useFakeTimers()` で時計を止めて縛る。ここを増やさない。

**編集は操作の関数で足す**。`edit/` のどれかに関数を 1 つ書いて、`textarea.ts` から
`関数(this.state, ...)` と呼ぶ。戻ってきた `Changed` を `applyChange` に渡すところまでが
`textarea.ts` の仕事。
**`Textarea` にメソッドを生やさない**。クラスにまとめると、操作が増えるたびに
1 つのファイルが太る。切り取り・変換の確定・語の選び方は `edit/` を読めば全部ある。

**import は名前で書く。`import * as` と barrel を置かない。**
まとめ役 (`edit/index.ts`) を置くと、`edit.selectedText` のように
**③ のものが ② の名前で出てくる**——実体は `state/query.ts` なのに、呼び手からは
区別が付かない。出どころごとに named import すれば、import の並びがそのまま
「この繋ぎ役が何に依っているか」の一覧になる。
代わりに `commands` と `edit/` で名前が重なる (`cut` / `undo` / `setSelection`)。
`this.apply(...)` に包まれている側が純粋な操作、と読む。

**両バックエンドは同じ振る舞いをする**。片方だけ直したら、もう片方も見る。
同じ判断を 2 度書かない——点滅のように両方が要るものは、`backend/` の共有部品に置いて
1 行ずつ呼ぶ。

**矢印は画面で見た向きに割り当てる**。縦書きならインライン方向が `↑↓`、ブロック方向が `←→`。
Linux / Windows の `<textarea>` と同じで、macOS の `<textarea>` とだけ違う
(あちらは矢印が OS のキーバインドから来るので、縦書きでも `←→` がインライン方向)。

**修飾キーは逆に、OS ごとに分ける**。語・段落へ動くのが macOS では `⌥`、それ以外では `Ctrl`。
端まで飛ぶのは macOS が `⌘` + 矢印、それ以外は `Home` / `End`。
向きは画面で揃えるが、修飾キーはネイティブに揃える——**入り口が OS ごとに違うから。**

**それ以外のキー操作は Blink の `<textarea>` を基準にする。**
迷ったら `test/native.browser.test.ts` に本物の textarea を並べて測る。
矢印は軸が入れ替わるので、こちらへ打つキーだけ `rotate()` で向きを直している。

## 言葉

コードのコメントも docs も、この語で書く。

| | |
| --- | --- |
| コンテナ | エディタを置く要素。`container` として受け取る。ResizeObserver が見ているのもこれ |
| レイアウト | 行分割と折り返し。組版そのもの |
| スクロール | 読み進んだ距離。向きに依らず 0 以上 |
| インライン方向 / ブロック方向 | 字が進む向き / 行が重なる向き。縦書きならインライン方向が縦、ブロック方向が横 |
| 行送り | 行と行の間隔 (CSS の `line-height`)。**方向ではない** |
| ハンドル | 選択の両端に出す、掴んで動かせる丸 |
| クリック / タップ | マウスで押す / 指で触る。動きは別なので語も分ける |
| 隠し入力 | 画面に出さない `<textarea>`。入力・IME・クリップボードを受ける |
| focus | DOM の focus (`document.activeElement`)。カタカナでは書かない |
| state | 編集の状態 (`EditState`)。本文・選択・履歴・変換中の字。作り直すもので、書き換えない |
| commands | 外から輪に入る口 (`textarea.commands`)。`edit/` の操作を `apply` に結び付けたもので、操作そのものではない。キー割り当てが作る内側の `Command` とも別物 |

## テスト

**場所は「何を見ているか」、名前は「どこで走るか」**。別の軸なので、別々の所に書く。

| | |
| --- | --- |
| `src/` の隣 (`input/gesture.test.ts`) | 単体。その 1 ファイルを見る |
| `test/` 直下 | 通し。`textarea.ts` をタップして組み立てを見る |
| `*.test.ts` | node で走る |
| `*.browser.test.ts` | chromium と webkit で走る |

こうしておくと **「単体だがブラウザが要る」が素直に書ける**——本物の Range で測る
`backend/dom/geometry.browser.test.ts` や、IME を受ける `input/hidden-input.browser.test.ts` は
単体なのに node には落とせない。走る場所をディレクトリで決めると、これらは
通しのテストに紛れ込むしかなくなる。

- **判定は純粋な側に出してから隣で縛る**。指の判定 (`input/gesture.test.ts`) がその形——
  閾値・回数・順番は node で測り、ブラウザには「本当にその順で届くか」だけを残す。
  編集の操作・キー割り当て・表示の決めごとも同じで、`edit/` は DOM を見ないので
  変換の並び (開始 → 更新 → 確定) まで node で縛れる。
- フェイクは `test/fakes/` に集める。計測器 (`measurer.ts`)、行の切れ目 (`layout.ts`)、
  矩形だけ答える中身 (`content.ts`)、フェイクバックエンド (`backend.ts`)。
- 通しは 5 つ。
  - `editor.browser.test.ts` … `describe.each` で両バックエンドを回す。追加すれば自動的に両方にかかる
  - `parity.browser.test.ts` … 2 つのバックエンドが同じところに着くことを縛る
  - `native.browser.test.ts` … Blink の `<textarea>` と突き合わせる。`userEvent` で本物のキーを打つ
  - `wrap.browser.test.ts` … 折り返しの境目
  - `textarea.browser.test.ts` … 組み立て。フェイクバックエンド (`test/fakes/backend.ts`) を渡し、
    隠し入力と指は本物を動かす。**差し替えるのは backend だけ**なので、node には落とせない
- **自作したイベントは、ブラウザが作る値を持っていない**。`new PointerEvent(...)` の
  `detail` は書いた本人の値なので、配線 (`event.detail` → `clicks`) はこれでは踏めない。
  そこを見たいなら `userEvent` で本物を打つ。
- **消したときに何が残るかを、テストごと見えるようにしておく**。`src/backend/dom` を
  消せば dom のテストも一緒に消え、①②③ のテストは 1 つも動かない。
