import { readFileSync } from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.cwd(), "extension/dist");
const bundles = ["content.js", "popup.js", "background.js"];

function stripStringLiterals(source) {
  return source
    .replace(/`(?:\\.|[^`\\])*`/gs, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "");
}

describe("extension build integrity", () => {
  for (const bundle of bundles) {
    it(`ships ${bundle} as a self-contained IIFE`, () => {
      const source = readFileSync(path.join(distDir, bundle), "utf8");
      const codeOnly = stripStringLiterals(source);

      expect(source.startsWith("(function") || source.startsWith("!function")).toBe(true);
      expect(/^import\s+/m.test(codeOnly)).toBe(false);
      expect(/^export\s+/m.test(codeOnly)).toBe(false);
      expect(source.includes('from"./chunks/')).toBe(false);
    });
  }
});
