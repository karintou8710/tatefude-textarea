import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages はリポジトリ名の下に置かれる。相対で出せばどこに置いても動く
  base: "./",
});
