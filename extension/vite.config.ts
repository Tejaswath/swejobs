import path from "node:path";
import { defineConfig } from "vite";

const extensionRoot = __dirname;
const srcRoot = path.resolve(extensionRoot, "src");
const distDir = path.resolve(extensionRoot, "dist");
const alias = {
  "@": path.resolve(extensionRoot, "../src"),
  ws: path.resolve(extensionRoot, "src/shims/ws.js"),
};

const entryName = (process.env.EXTENSION_ENTRY ?? "content") as "content" | "popup" | "background";

/**
 * Chrome content scripts cannot load ES-module chunk files from manifest.json.
 * Build each entry separately as a single self-contained bundle (no shared chunks).
 * Run via: EXTENSION_ENTRY=content|popup|background npm run build:extension
 */
export default defineConfig({
  resolve: { alias },
  publicDir: false,
  build: {
    outDir: distDir,
    emptyOutDir: entryName === "content",
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(srcRoot, `${entryName}.js`),
      output: {
        entryFileNames: "[name].js",
        inlineDynamicImports: true,
        format: entryName === "content" ? "iife" : "es",
      },
    },
  },
});
