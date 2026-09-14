import { defineConfig } from "tsdown";

// 1 ファイルに束ねる。ソースの相対 import は拡張子なしなので、
// tsc の素の出力では Node の ESM 解決が通らない
export default defineConfig({
  entry: "src/index.ts",
  format: "esm",
  dts: true,
  clean: true,
  sourcemap: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
