# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コードコメント

- WHY だけ書く。コードを読めば分かる WHAT は書かない。
- 短く、シンプルに。

## 置き場所

- `packages/core` … DOM に依存する部分と、しない部分を分けて置く。
  レイアウト (`src/layout`, `src/text`, `src/model`) は canvas を触らないので node のテストで回せる。
- `packages/react` … core を包むだけ。ロジックを持たせない。

## テスト

- レイアウト・禁則・移動の判定は `test/unit` に node のテストとして書く。計測器は `test/fake-measurer.ts` を使う。
- 入力・IME・キャレットは `test/browser` に chromium のテストとして書く。
