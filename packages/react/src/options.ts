import { useRef } from "react";
import type { TextareaOptions } from "tatefude-textarea";
import type { TextareaProps } from "./types";

/** React 側の props を落として、core にそのまま渡せる形にする */
export function coreOptions({
  ref: _ref,
  value: _value,
  defaultValue: _defaultValue,
  className: _className,
  style: _style,
  ...options
}: TextareaProps): TextareaOptions {
  return options;
}

/**
 * 描画設定はどれも素の値なので、中身が同じなら同じ参照を返す。
 * 呼ぶ側は毎回オブジェクトリテラルを書くので、参照だけ見ると毎描画で変わってしまう。
 */
export function useStableOptions(props: TextareaProps): TextareaOptions {
  const options = plainOptions(props);
  const key = JSON.stringify(options);
  const held = useRef({ key, options });
  if (held.current.key !== key) held.current = { key, options };
  return held.current.options;
}

/**
 * 値だけを、キー順を揃えて取り出す。
 * ハンドラを混ぜないのは比較のためだけではない。setOptions は渡されたものを
 * 上書きするので、生成時に仕込んだ「ref 越しに呼ぶラッパー」を潰してしまう。
 */
function plainOptions(props: TextareaProps): TextareaOptions {
  const source = coreOptions(props) as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (typeof source[key] === "function") continue;
    sorted[key] = source[key];
  }
  return sorted as TextareaOptions;
}
