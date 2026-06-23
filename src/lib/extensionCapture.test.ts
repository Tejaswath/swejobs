import { describe, expect, it } from "vitest";

import {
  buildLinkedInJobViewUrl,
  extractLinkedInJob,
  filterAggregatorSiteName,
  getLinkedInJobIdFromUrl,
  inferBrandFromHostname,
  isAggregatorSiteName,
  isLinkedInNoiseTitle,
  isPlausiblePersonName,
  parseLinkedInDocumentTitle,
  sanitizeRecruiterName,
  shouldShowCaptureFab,
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

  it("extracts LinkedIn title and company from unified top card", () => {
    document.body.innerHTML = `
      <div class="job-details-jobs-unified-top-card__job-title">Software Engineer, iOS</div>
      <div class="job-details-jobs-unified-top-card__company-name"><a>H&amp;M</a></div>
    `;

    const result = extractLinkedInJob(
      document,
      "https://www.linkedin.com/jobs/view/123",
      "Software Engineer, iOS | H&M | LinkedIn",
    );
    expect(result?.title).toBe("Software Engineer, iOS");
    expect(result?.company).toBe("H&M");
  });

  it("extracts LinkedIn metadata from collections split-pane and currentJobId", () => {
    document.body.innerHTML = `
      <div class="jobs-search__job-details--container">
        <div class="job-details-jobs-unified-top-card__job-title">Junior Data Scientist</div>
        <div class="job-details-jobs-unified-top-card__company-name"><a>Hedvig</a></div>
      </div>
      <li data-occludable-job-id="4426039713" class="jobs-search-results__list-item--active">
        <div class="job-card-list__title">Junior Data Scientist</div>
        <div class="job-card-container__company-name">Hedvig</div>
      </li>
    `;

    const href =
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4426039713";
    const result = extractLinkedInJob(
      document,
      href,
      "Junior Data Scientist | Hedvig | LinkedIn",
    );

    expect(result?.title).toBe("Junior Data Scientist");
    expect(result?.company).toBe("Hedvig");
    expect(result?.jobId).toBe("4426039713");
    expect(getLinkedInJobIdFromUrl(href)).toBe("4426039713");
    expect(buildLinkedInJobViewUrl("4426039713")).toBe(
      "https://www.linkedin.com/jobs/view/4426039713/",
    );
  });

  it("falls back to document title when DOM is sparse", () => {
    document.body.innerHTML = `<h1>0 notifications</h1>`;

    const result = extractLinkedInJob(
      document,
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=99",
      "(10) Junior Data Scientist | Hedvig | LinkedIn",
    );

    expect(result?.title).toBe("Junior Data Scientist");
    expect(result?.company).toBe("Hedvig");
    expect(isLinkedInNoiseTitle("0 notifications")).toBe(true);
  });

  it("does not infer linkedin as employer hostname", () => {
    expect(inferBrandFromHostname("www.linkedin.com")).toBe("");
    expect(inferBrandFromHostname("hedvig.teamtailor.com")).toBe("Hedvig");
  });

  it("returns null for non-LinkedIn pages", () => {
    document.body.innerHTML = `<h1>Backend Engineer</h1>`;
    expect(extractLinkedInJob(document, "https://jobs.lever.co/acme/abc")).toBeNull();
  });

  it("knows when to show the capture FAB", () => {
    expect(shouldShowCaptureFab("https://www.linkedin.com/jobs/collections/recommended/")).toBe(
      true,
    );
    expect(shouldShowCaptureFab("https://hedvig.teamtailor.com/jobs/123")).toBe(true);
    expect(shouldShowCaptureFab("https://example.com/blog")).toBe(false);
  });
});
