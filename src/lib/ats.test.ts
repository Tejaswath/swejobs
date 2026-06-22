import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import atsCases from "../../tests/fixtures/ats_keyword_cases.json";
import {
  MAX_JOB_ATS_KEYWORDS,
  buildJobAtsKeywords,
  extractKeywordsFromJobText,
  matchResumeToJob,
  runAtsScan,
  type JobAtsKeywordInput,
} from "@/lib/ats";

const fixtureCases = atsCases as Array<{
  id: string;
  input: JobAtsKeywordInput;
}>;

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

describe("buildJobAtsKeywords", () => {
  it("places structured tags before prose keywords", () => {
    const keywords = buildJobAtsKeywords(fixtureCases[0].input);
    expect(keywords.slice(0, 3)).toEqual(["react", "typescript", "aws"]);
    expect(keywords.filter((keyword) => keyword === "react")).toHaveLength(1);
  });

  it("prefers english translation prose for swedish jobs when available", () => {
    const keywords = buildJobAtsKeywords(fixtureCases[1].input);
    expect(keywords).toContain("python");
    expect(keywords).toContain("docker");
    expect(keywords).not.toContain("din");
    expect(keywords).not.toContain("karriär");
    expect(keywords).not.toContain("karriar");
  });

  it("falls back to swedish prose when translation is absent", () => {
    const keywords = buildJobAtsKeywords(fixtureCases[2].input);
    expect(keywords[0]).toBe("java");
    expect(keywords).toContain("spring boot");
  });

  it("keeps all structured tags even when they exceed the prose cap", () => {
    const tags = Array.from({ length: 30 }, (_, index) => `skill-${index}`);
    const keywords = buildJobAtsKeywords({
      tags,
      headline: "Engineer",
      description: "Requirements: Python and SQL experience.",
      language: "en",
    });
    expect(keywords.length).toBe(30);
    expect(keywords[0]).toBe("skill-0");
    expect(keywords[29]).toBe("skill-29");
    expect(keywords).not.toContain("python");
  });

  it("supports description-only jobs", () => {
    const keywords = buildJobAtsKeywords(fixtureCases[4].input);
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords).toContain("python");
    expect(keywords).toContain("machine learning");
  });

  it("returns stable keyword order for stable input", () => {
    const input = fixtureCases[0].input;
    expect(buildJobAtsKeywords(input)).toEqual(buildJobAtsKeywords(input));
  });

  it("filters swedish filler words from prose but keeps structured tags", () => {
    const keywords = buildJobAtsKeywords({
      tags: ["React"],
      headline: "Utvecklare",
      description: "Vi söker dig som vill bidra inom din karriär med React.",
      language: "sv",
    });
    expect(keywords[0]).toBe("react");
    expect(keywords).not.toContain("din");
    expect(keywords).not.toContain("dig");
    expect(keywords).not.toContain("karriär");
  });
});

describe("matchResumeToJob parity", () => {
  const resumeText = "Built React and TypeScript services on AWS with GraphQL APIs.";

  it("returns identical results for repeated calls", () => {
    const job = fixtureCases[0].input;
    const first = matchResumeToJob(job, { resumeText });
    const second = matchResumeToJob(job, { resumeText });
    expect(first).toEqual(second);
  });

  it("matches list-style and detail-style job inputs identically", () => {
    const sharedTags = ["React", "TypeScript", "AWS"];
    const listStyleJob: JobAtsKeywordInput = {
      tags: sharedTags,
      headline: "Frontend Engineer",
      description: "Requirements: React, TypeScript, and AWS experience. Nice to have GraphQL.",
      headlineEn: null,
      descriptionEn: null,
      language: "en",
      occupationLabel: "Software Developer",
    };
    const detailStyleJob: JobAtsKeywordInput = {
      tags: sharedTags,
      headline: "Frontend Engineer",
      description: "Requirements: React, TypeScript, and AWS experience. Nice to have GraphQL.",
      headlineEn: null,
      descriptionEn: null,
      language: "en",
      occupationLabel: "Software Developer",
    };

    expect(matchResumeToJob(listStyleJob, { resumeText })).toEqual(
      matchResumeToJob(detailStyleJob, { resumeText }),
    );
  });

  it("does not change score when only display-language fields differ", () => {
    const swedishDisplay: JobAtsKeywordInput = {
      tags: ["Python"],
      headline: "Backendutvecklare",
      description: "Vi söker dig som har erfarenhet av din karriär inom utveckling.",
      headlineEn: "Backend Developer",
      descriptionEn: "Requirements: Python and Docker. Build REST APIs and distributed systems.",
      language: "sv",
    };
    const score = matchResumeToJob(swedishDisplay, {
      resumeText: "Python developer with Docker and REST API experience.",
    }).score;
    expect(score).toBeGreaterThan(0);
    expect(
      matchResumeToJob(swedishDisplay, {
        resumeText: "Python developer with Docker and REST API experience.",
      }).score,
    ).toBe(score);
  });

  it("handles empty resume text safely", () => {
    const result = matchResumeToJob(fixtureCases[0].input, { resumeText: "" });
    expect(result.score).toBe(0);
    expect(result.matchedKeywords).toEqual([]);
    expect(result.missingKeywords.length).toBeGreaterThan(0);
  });

  it("handles whitespace-only resume text safely", () => {
    const result = matchResumeToJob(fixtureCases[0].input, { resumeText: "   \n\t  " });
    expect(result.score).toBe(0);
    expect(result.matchedKeywords).toEqual([]);
  });
});

describe("fixture snapshot anchors", () => {
  it("loads ats keyword fixtures from the shared tests directory", () => {
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/ats_keyword_cases.json");
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown[];
    expect(raw).toHaveLength(fixtureCases.length);
  });
});
