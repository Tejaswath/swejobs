import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const distDir = path.resolve(process.cwd(), "extension/dist");

describe("extension build integrity", () => {
  it("ships a self-contained content script without ES module imports", () => {
    const content = readFileSync(path.join(distDir, "content.js"), "utf8");
    expect(content.startsWith("(function")).toBe(true);
    expect(/^import\s/m.test(content)).toBe(false);
    expect(content.includes('from"./chunks/')).toBe(false);
  });

  it("does not emit shared chunk files", () => {
    const popup = readFileSync(path.join(distDir, "popup.js"), "utf8");
    expect(popup.includes('from"./chunks/')).toBe(false);
  });
});
