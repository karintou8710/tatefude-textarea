# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コードコメント

- WHY だけ書く。コードを読めば分かる WHAT は書かない。
- 短く、シンプルに。

## 置き場所

- `packages/core/src/textarea.ts` … テキスト・選択・履歴・キー操作・IME。
  組み方と描き方は持たない。
- `packages/core/src/backend.ts` … 組み方と描き方の境界。ここを実装すれば別の組み方を足せる。
- `packages/core/src/canvas` … 字を 1 つずつ canvas に置く実装。
  レイアウト (`layout`, `text/char-class`) は canvas を触らないので node のテストで回せる。
- `packages/core/src/dom` … writing-mode に組ませる実装。
- `packages/react` … core を包むだけ。ロジックを持たせない。

**両バックエンドは同じ振る舞いをする。**片方だけ直したら、もう片方も見る。

**矢印は画面で見た向きに割り当てる。**縦書きなら字送りが `↑↓`、行送りが `←→`。
ここだけはネイティブの `<textarea>` と違う (あちらは縦書きでも `←→` が字送り)。

**それ以外のキー操作は Blink の `<textarea>` を基準にする。**
迷ったら `test/browser/native.test.ts` に本物の textarea を並べて測る。
矢印は軸が入れ替わるので、こちらへ打つキーだけ `rotate()` で向きを直している。

## テスト

- レイアウト・禁則・移動の判定は `test/unit` に node のテストとして書く。計測器は `test/fake-measurer.ts` を使う。
- 入力・IME・キャレットは `test/browser` に書く。chromium と webkit の両方で回る。
  - `editor.test.ts` … `describe.each` で両バックエンドを回す。追加すれば自動的に両方にかかる
  - `parity.test.ts` … 2 つのバックエンドが同じところに着くことを縛る
  - `native.test.ts` … Blink の `<textarea>` と突き合わせる。`userEvent` で本物のキーを打つ
