import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    exclude: ["node_modules/**", "dist/**", "dist-electron/**", "release/**"]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
