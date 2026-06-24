import { describe, expect, it } from "vitest";

import {
  buildAutofillValues,
  buildFieldHaystack,
  collectFieldHaystacks,
  countApplicationLikeFields,
  detectApplicationFieldCount,
  findAutofillField,
  findResumeFileInput,
  inferAutofillProvider,
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

  it("infers provider from hostname", () => {
    expect(inferAutofillProvider("hedvig.teamtailor.com")).toBe("teamtailor");
    expect(inferAutofillProvider("company.wd3.myworkdayjobs.com")).toBe("workday");
    expect(inferAutofillProvider("boards.greenhouse.io")).toBe("generic");
  });

  it("finds Teamtailor candidate fields", () => {
    document.body.innerHTML = `
      <input name="candidate[first_name]" id="candidate_first_name" />
      <input name="candidate[email]" type="email" />
      <input type="file" name="candidate[resume]" />
    `;

    expect(findAutofillField(document, "first_name", "teamtailor")?.getAttribute("name")).toBe(
      "candidate[first_name]",
    );
    expect(findAutofillField(document, "email", "teamtailor")?.type).toBe("email");
    expect(findResumeFileInput(document, "teamtailor")?.getAttribute("name")).toBe("candidate[resume]");
    expect(detectApplicationFieldCount(document)).toBeGreaterThanOrEqual(2);
  });

  it("finds Workday data-automation-id fields", () => {
    document.body.innerHTML = `
      <input data-automation-id="formField-legalNameSection_firstName" />
      <input data-automation-id="formField-email" type="email" />
      <input type="file" data-automation-id="formField-resume" />
    `;

    expect(findAutofillField(document, "first_name", "workday")?.getAttribute("data-automation-id")).toContain(
      "firstName",
    );
    expect(findAutofillField(document, "email", "workday")?.type).toBe("email");
    expect(findResumeFileInput(document, "workday")?.getAttribute("data-automation-id")).toContain("resume");
    expect(collectFieldHaystacks(document).length).toBeGreaterThanOrEqual(3);
  });
});
