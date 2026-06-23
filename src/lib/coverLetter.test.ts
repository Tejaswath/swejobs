import { describe, expect, it } from "vitest";

import { DEFAULT_COVER_LETTER_TEMPLATE, renderCoverLetter } from "@/lib/coverLetter";
import type { UserProfileRow } from "@/lib/profile";

const profile = {
  user_id: "user-1",
  first_name: "Anna",
  last_name: "Forsström",
  full_name: "Anna Forsström",
  email: "anna@example.com",
  phone: "+46 70 123 45 67",
  headline: "Junior developer",
  location: "Stockholm",
  linkedin_url: "https://linkedin.com/in/anna",
  portfolio_url: "",
  about_me: "I build reliable web apps and enjoy data-heavy products.",
  autofill_extra: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
} satisfies UserProfileRow;

describe("coverLetter", () => {
  it("renders placeholders for a job and profile", () => {
    const letter = renderCoverLetter(
      DEFAULT_COVER_LETTER_TEMPLATE,
      { company: "Hedvig", job_title: "Junior Data Scientist" },
      profile,
    );

    expect(letter).toContain("Dear Hedvig team");
    expect(letter).toContain("Junior Data Scientist");
    expect(letter).toContain("Anna Forsström");
    expect(letter).toContain("anna@example.com");
    expect(letter).toContain("data-heavy products");
  });

  it("falls back when profile fields are missing", () => {
    const letter = renderCoverLetter(
      "Hello {{company}} — {{jobTitle}} — {{firstName}}",
      { company: "", job_title: "" },
      null,
    );

    expect(letter).toContain("Hello your");
    expect(letter).toContain("this role");
  });
});
