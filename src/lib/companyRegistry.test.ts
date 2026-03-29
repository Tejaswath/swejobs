import { describe, expect, it } from "vitest";
import {
  companyCoverageStatusCounts,
  findCompanyRegistryEntry,
  getCompanyRegistryEntryByCanonical,
  normalizeCompanyKey,
  providerLabel,
} from "@/lib/companyRegistry";

describe("companyRegistry helpers", () => {
  it("normalizes legal suffixes from company names", () => {
    expect(normalizeCompanyKey("  Klarna Bank AB  ")).toBe("klarna bank");
    expect(normalizeCompanyKey("Telefonaktiebolaget LM Ericsson")).toBe("telefonaktiebolaget lm ericsson");
  });

  it("resolves registry entries from aliases", () => {
    const ericsson = findCompanyRegistryEntry("Telefonaktiebolaget LM Ericsson");
    expect(ericsson?.company_canonical).toBe("ericsson");

    const seb = findCompanyRegistryEntry("Skandinaviska Enskilda Banken");
    expect(seb?.company_canonical).toBe("seb");
  });

  it("returns canonical entry and provider labels", () => {
    const klarna = getCompanyRegistryEntryByCanonical("klarna");
    expect(klarna?.display_name).toContain("Klarna");
    expect(providerLabel("greenhouse")).toBe("Greenhouse");
    expect(providerLabel(null)).toBe("Unknown");
  });

  it("includes connected_jobtech in coverage counts", () => {
    const counts = companyCoverageStatusCounts();
    expect(counts.connected_jobtech).toBeGreaterThan(0);
  });
});
