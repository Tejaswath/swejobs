import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "extension/dist");
const bundles = ["content.js", "popup.js", "background.js"];

function stripStringLiterals(source) {
  return source
    .replace(/`(?:\\.|[^`\\])*`/gs, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "");
}

function assertBundle(fileName) {
  const filePath = path.join(distDir, fileName);
  const source = readFileSync(filePath, "utf8");
  const codeOnly = stripStringLiterals(source);

  if (source.includes('from"./chunks/') || source.includes("from './chunks/")) {
    throw new Error(`${fileName} imports shared chunks; Chrome extension scripts cannot load them.`);
  }

  if (/^import\s+/m.test(codeOnly)) {
    throw new Error(`${fileName} contains a top-level import statement.`);
  }

  if (/^export\s+/m.test(codeOnly)) {
    throw new Error(`${fileName} contains a top-level export statement.`);
  }

  if (!source.startsWith("(function") && !source.startsWith("!function")) {
    throw new Error(`${fileName} must be built as an IIFE bundle.`);
  }
}

for (const bundle of bundles) {
  assertBundle(bundle);
}

console.log(`[OK] extension bundles verified (${bundles.join(", ")})`);
