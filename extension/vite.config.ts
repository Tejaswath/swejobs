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

const entryGlobalName =
  entryName === "content"
    ? "SweJobsContent"
    : entryName === "popup"
      ? "SweJobsPopup"
      : "SweJobsBackground";

/**
 * Chrome extension scripts must be classic single-file bundles.
 * Build each entry separately with inlineDynamicImports + IIFE output.
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
        format: "iife",
        name: entryGlobalName,
      },
    },
  },
});
