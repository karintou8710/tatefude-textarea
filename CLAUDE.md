# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コードコメント

- WHY だけ書く。コードを読めば分かる WHAT は書かない。
- 短く、シンプルに。

## 置き場所

**`src` 直下はバックエンドに依らないものだけ。**組み方と描き方は `src/backend` の中で閉じる。
バックエンドを 1 つ消したときに何が残るかが、そのまま見えるようにしておく。

- `packages/core/src/textarea.ts` … テキスト・選択・履歴・キー操作・IME。
  組み方と描き方は持たない。
- `packages/core/src/backend/backend.ts` … 組み方と描き方の境界。
  ここを実装すれば別の組み方を足せる。
- `packages/core/src/backend/scroll.ts` … 両バックエンドが使う。
  `vertical-rl` の `scrollLeft` は Blink が負・WebKit が正へ動くので、ここで距離に均す。
- `packages/core/src/backend/canvas` … 字を 1 つずつ canvas に置く実装。**公開していない。**
  見た目を数値で要求するので、CSS に寄せた公開 API からは切り離して
  `canvas/style.ts` に凍らせてある。
  **canvas 経路でしか使わないものはここに置く。** 外から参照しているものがあれば、
  それは共有すべきか置き場所が違うかのどちらか。
  レイアウト (`layout.ts`, `geometry.ts`, `char-class.ts`, `measure.ts`, `movement.ts`) は
  canvas を触らないので node のテストで回せる。
- `packages/core/src/backend/dom` … writing-mode に組ませる実装。
- `packages/react` … core を包むだけ。ロジックを持たせない。

**公開するのは使うためのものと、別の組み方を足すためのものだけ。**
`src/index.ts` に出すと消せなくなる。組み方の中身は出さない。
入口は 1 つ (`tatefude-textarea`)。サブパスは切らない。

**寸法と組み方は CSS、色は props。**字の大きさ・行送り・余白・禁則は container の
計算スタイルから読む (`className` でも当てられる)。色だけは `theme` で受ける——
選択も変換中の下線も自前の要素で `::selection` が効かず、canvas は値そのものを要り、
CSS 変数だと型が付かないため。
`writingMode` は CSS の `writing-mode` と同じものだが、矢印がどちらへ動くかを
決める振る舞いなので props で受ける。
CSS には変更を知らせる口が無いので、変えた側が `refresh()` を呼ぶ。

**内部の要素に名前を付けない。**クラス名で色を受けると、要素の並びがそのまま
公開契約になる。色は `theme` で受けて、内側でどう描くかは外から見えないままにする。

**両バックエンドは同じ振る舞いをする。**片方だけ直したら、もう片方も見る。

**矢印は画面で見た向きに割り当てる。**縦書きなら字送りが `↑↓`、行送りが `←→`。
Linux / Windows の `<textarea>` と同じで、macOS の `<textarea>` とだけ違う
(あちらは矢印が OS のキーバインドから来るので、縦書きでも `←→` が字送り)。

**それ以外のキー操作は Blink の `<textarea>` を基準にする。**
迷ったら `test/browser/native.test.ts` に本物の textarea を並べて測る。
矢印は軸が入れ替わるので、こちらへ打つキーだけ `rotate()` で向きを直している。

## テスト

- レイアウト・禁則・移動の判定は `test/unit` に node のテストとして書く。計測器は `test/fake-measurer.ts` を使う。
- 入力・IME・キャレットは `test/browser` に書く。chromium と webkit の両方で回る。
  - `editor.test.ts` … `describe.each` で両バックエンドを回す。追加すれば自動的に両方にかかる
  - `parity.test.ts` … 2 つのバックエンドが同じところに着くことを縛る
  - `native.test.ts` … Blink の `<textarea>` と突き合わせる。`userEvent` で本物のキーを打つ
