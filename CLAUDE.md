# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コードコメント

- WHY だけ書く。コードを読めば分かる WHAT は書かない。
- 短く、シンプルに。

## 置き場所

- `packages/core/src/vert-textarea.ts` … テキスト・選択・履歴・キー操作・IME。
  組み方と描き方は持たない。
- `packages/core/src/backend.ts` … 組み方と描き方の境界。ここを実装すれば別の組み方を足せる。
- `packages/core/src/canvas` … 字を 1 つずつ canvas に置く実装。
  レイアウト (`layout`, `text/char-class`) は canvas を触らないので node のテストで回せる。
- `packages/core/src/dom` … writing-mode に組ませる実装。
- `packages/react` … core を包むだけ。ロジックを持たせない。

**両バックエンドは同じ振る舞いをする。**片方だけ直したら、もう片方も見る。

## テスト

- レイアウト・禁則・移動の判定は `test/unit` に node のテストとして書く。計測器は `test/fake-measurer.ts` を使う。
- 入力・IME・キャレットは `test/browser` に chromium のテストとして書く。
  ここは `describe.each` で両バックエンドを回しているので、追加したテストは自動的に両方にかかる。
