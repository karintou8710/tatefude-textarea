import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * **場所は「何を見ているか」、名前は「どこで走るか」。**
 *
 * 隣に置いたテストは単体 (src/**)、test/ 直下は textarea.ts を通すもの。
 * `*.browser.test.ts` だけがブラウザで走る。
 * 「単体だがブラウザが要る」(本物の Range、IME) が素直に書けるようにするため、
 * 走る場所をディレクトリで決めない。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // レイアウトは canvas の計測を差し替えれば node で回せる
          name: "node",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts", "test/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "webkit" }],
          },
        },
      },
    ],
  },
});
