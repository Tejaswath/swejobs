import { describe, expect, it } from "vitest";
import { extractKeywordsFromJobText, runAtsScan } from "@/lib/ats";

describe("ats helpers", () => {
  it("extracts weighted phrases from requirement sections", () => {
    const text = `
Krav
Du behöver erfarenhet av spring boot, kubernetes och distributed systems.

Meriterande
Kunskap om machine learning och python.
`;
    const keywords = extractKeywordsFromJobText(text, 20);
    expect(keywords).toContain("spring boot");
    expect(keywords).toContain("kubernetes");
    expect(keywords).toContain("distributed systems");
  });

  it("matches synonym variants and tracks missing skills", () => {
    const result = runAtsScan({
      resumeText: "Built JS services on AWS cloud and React applications",
      targetKeywords: ["javascript", "aws", "kubernetes"],
      trackedSkills: ["kubernetes"],
    });
    expect(result.score).toBe(67);
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(["javascript", "aws"]));
    expect(result.trackedMissingKeywords).toEqual(["kubernetes"]);
  });

  it("does not promote one-off noisy bigrams", () => {
    const keywords = extractKeywordsFromJobText("alpha beta gamma delta", 20);
    expect(keywords).not.toContain("alpha beta");
    expect(keywords).not.toContain("beta gamma");
  });
});
