import { describe, expect, it } from "vitest";

import { buildFullName, normalizeUserProfileInput, suggestProfileFieldsFromResumeText } from "@/lib/profile";

describe("profile", () => {
  it("builds full name from split fields", () => {
    expect(buildFullName("Anna", "Forsström")).toBe("Anna Forsström");
    expect(buildFullName("", "", "Legacy Name")).toBe("Legacy Name");
  });

  it("normalizes profile input and derives full_name", () => {
    expect(
      normalizeUserProfileInput({
        first_name: " Tejas ",
        last_name: "Wath",
        email: "tejas@example.com",
      }),
    ).toEqual({
      first_name: "Tejas",
      last_name: "Wath",
      full_name: "Tejas Wath",
      email: "tejas@example.com",
      phone: "",
      headline: "",
      location: "",
      linkedin_url: "",
      portfolio_url: "",
      about_me: "",
      autofill_extra: {},
    });
  });

  it("suggests basic fields from resume text", () => {
    const suggestions = suggestProfileFieldsFromResumeText(`
      Anna Forsström
      anna@example.com
      +46 70 123 45 67
    `);

    expect(suggestions.first_name).toBe("Anna");
    expect(suggestions.last_name).toBe("Forsström");
    expect(suggestions.email).toBe("anna@example.com");
    expect(suggestions.phone).toContain("+46");
  });
});
