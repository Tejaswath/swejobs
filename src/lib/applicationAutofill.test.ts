import { describe, expect, it } from "vitest";

import {
  buildAutofillValues,
  buildFieldHaystack,
  countApplicationLikeFields,
  matchAutofillKey,
} from "@/lib/applicationAutofill";

describe("applicationAutofill", () => {
  it("builds autofill values from split profile names", () => {
    expect(
      buildAutofillValues(
        {
          first_name: "Anna",
          last_name: "Forsström",
          email: "anna@example.com",
          phone: "+46 70 123 45 67",
          linkedin_url: "https://linkedin.com/in/anna",
        },
        "Dear team,\n\nI am interested.",
      ),
    ).toEqual({
      first_name: "Anna",
      last_name: "Forsström",
      email: "anna@example.com",
      phone: "+46 70 123 45 67",
      linkedin_url: "https://linkedin.com/in/anna",
      portfolio_url: "",
      cover_letter: "Dear team,\n\nI am interested.",
    });
  });

  it("matches common ATS field labels", () => {
    expect(matchAutofillKey("job_application[first_name]")).toBe("first_name");
    expect(matchAutofillKey("phone number")).toBe("phone");
    expect(matchAutofillKey("cover letter")).toBe("cover_letter");
  });

  it("counts distinct application-like fields", () => {
    const count = countApplicationLikeFields([
      buildFieldHaystack(["first_name", "Anna"]),
      buildFieldHaystack(["email", "Email address"]),
      buildFieldHaystack(["resume", "Upload resume"]),
    ]);
    expect(count).toBe(2);
  });
});
