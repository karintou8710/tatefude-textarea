import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: "esm",
  dts: true,
  clean: true,
  sourcemap: true,
  deps: {
    neverBundle: ["react", "react/jsx-runtime", "canvas-vert-textarea", "canvas-vert-textarea/dom"],
  },
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
