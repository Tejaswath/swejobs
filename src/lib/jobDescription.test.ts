import { describe, expect, it } from "vitest";

import { normalizeJobDescription, parseJobDescriptionSections } from "@/lib/jobDescription";

describe("jobDescription", () => {
  it("decodes HTML entities and preserves paragraph breaks", () => {
    const raw = "&lt;p&gt;We build software.&lt;/p&gt;&lt;p&gt;&lt;strong&gt;Key Responsibilities&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Ship features&lt;/li&gt;&lt;/ul&gt;";
    const normalized = normalizeJobDescription(raw);
    expect(normalized).toContain("We build software.");
    expect(normalized).toContain("Key Responsibilities");
    expect(normalized).toContain("• Ship features");
  });

  it("splits structured sections from plain text", () => {
    const raw =
      "About the role. We are growing fast. Key Responsibilities: Build APIs and services. What we offer: Flexible remote work.";
    const sections = parseJobDescriptionSections(raw);
    expect(sections.some((section) => section.title === "Key Responsibilities")).toBe(true);
    expect(sections.some((section) => section.title === "What we offer")).toBe(true);
  });
});
