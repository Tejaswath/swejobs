import { describe, expect, it } from "vitest";

import {
  extractLinkedInJob,
  filterAggregatorSiteName,
  isAggregatorSiteName,
  isPlausiblePersonName,
  sanitizeRecruiterName,
} from "@/lib/extensionCapture";

describe("extensionCapture", () => {
  it("flags known aggregator site names", () => {
    expect(isAggregatorSiteName("LinkedIn")).toBe(true);
    expect(isAggregatorSiteName("H&M")).toBe(false);
    expect(filterAggregatorSiteName("LinkedIn")).toBe("");
    expect(filterAggregatorSiteName("Spotify")).toBe("Spotify");
  });

  it("rejects garbage recruiter names", () => {
    expect(isPlausiblePersonName("than those who don")).toBe(false);
    expect(isPlausiblePersonName("Anna Forsström")).toBe(true);
    expect(sanitizeRecruiterName("than those who don")).toBe("");
    expect(sanitizeRecruiterName("Anna Forsström")).toBe("Anna Forsström");
  });

  it("extracts LinkedIn title and company from DOM", () => {
    document.body.innerHTML = `
      <div class="job-details-jobs-unified-top-card__job-title">Software Engineer, iOS</div>
      <div class="job-details-jobs-unified-top-card__company-name"><a>H&amp;M</a></div>
    `;

    const result = extractLinkedInJob(document, "https://www.linkedin.com/jobs/view/123");
    expect(result?.title).toBe("Software Engineer, iOS");
    expect(result?.company).toBe("H&M");
  });

  it("returns null for non-LinkedIn pages", () => {
    document.body.innerHTML = `<h1>Backend Engineer</h1>`;
    expect(extractLinkedInJob(document, "https://jobs.lever.co/acme/abc")).toBeNull();
  });
});
