import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: "esm",
  dts: true,
  clean: true,
  sourcemap: true,
  deps: { neverBundle: ["react", "react/jsx-runtime", "canvas-vert-textarea"] },
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
