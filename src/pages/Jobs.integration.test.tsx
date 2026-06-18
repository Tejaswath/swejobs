import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import Jobs, { isGraduateTraineeCandidate, normalizeLensParam } from "@/pages/Jobs";

const supabase = vi.hoisted(() => {
  const job = {
    id: 1,
    is_active: true,
    headline: "Backend Engineer",
    headline_en: null,
    description: "Build reliable backend services.",
    description_en: null,
    employer_name: "Example AB",
    company_canonical: "example",
    company_tier: "A",
    municipality: "Stockholm",
    region: "Stockholm",
    lang: "en",
    remote_flag: false,
    published_at: "2026-06-15T08:00:00+00:00",
    application_deadline: null,
    employment_type: "Permanent",
    working_hours: "Full-time",
    occupation_label: "Software Engineer",
    source_url: "https://example.com/jobs/1",
    relevance_score: 70,
    role_family: "backend",
    role_family_confidence: 0.95,
    career_stage: "junior",
    career_stage_confidence: 0.9,
    is_grad_program: false,
    years_required_min: 1,
    swedish_required: false,
    consultancy_flag: false,
    citizenship_required: false,
    security_clearance_required: false,
    reason_codes: ["role_family_title_signal", "career_stage_junior"],
    source_provider: "greenhouse",
    source_kind: "direct_company_ats",
    source_feed_key: "example_greenhouse",
    is_direct_company_source: true,
    is_target_role: true,
    is_noise: false,
    source_feed_registry: { quality_band: "verified", high_signal_eligible: true, enabled: true },
  };

  const createThenableBuilder = (result: { data: unknown; error: null; count?: number }) => {
    const builder: Record<string, unknown> = {};
    const chain = () => proxy;
    const proxy = new Proxy(builder, {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (value: { data: unknown; error: null; count?: number }) => unknown, reject?: (reason?: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        if (prop === "single" || prop === "maybeSingle") {
          return async () => ({ ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data });
        }
        if (
          prop === "select" ||
          prop === "insert" ||
          prop === "update" ||
          prop === "upsert" ||
          prop === "delete" ||
          prop === "eq" ||
          prop === "neq" ||
          prop === "gt" ||
          prop === "gte" ||
          prop === "lt" ||
          prop === "lte" ||
          prop === "in" ||
          prop === "or" ||
          prop === "not" ||
          prop === "is" ||
          prop === "like" ||
          prop === "ilike" ||
          prop === "contains" ||
          prop === "order" ||
          prop === "range" ||
          prop === "limit"
        ) {
          return chain;
        }
        return undefined;
      },
    });
    return proxy;
  };

  return {
    from: (table: string) => {
      if (table === "jobs") return createThenableBuilder({ data: [job], error: null, count: 1 });
      if (table === "job_tags") {
        return createThenableBuilder({ data: [{ job_id: 1, tag: "backend" }], error: null, count: 1 });
      }
      if (table === "resume_versions") {
        return createThenableBuilder({
          data: [{ id: "resume-1", label: "Default resume", parsed_text: "backend services", is_default: true }],
          error: null,
          count: 1,
        });
      }
      if (table === "user_skills") {
        return createThenableBuilder({ data: [{ skill: "backend" }], error: null, count: 1 });
      }
      return createThenableBuilder({ data: [], error: null, count: 0 });
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase,
}));

describe("Jobs page", () => {
  it("normalizes public lens URL aliases", () => {
    expect(normalizeLensParam("graduate")).toBe("graduate_trainee");
    expect(normalizeLensParam("graduate-trainee")).toBe("graduate_trainee");
    expect(normalizeLensParam("high-signal")).toBe("high_signal");
    expect(normalizeLensParam("for-you")).toBe("broad");
    expect(normalizeLensParam("unknown")).toBe("broad");
  });

  it("does not treat missing experience metadata as graduate eligible", () => {
    expect(
      isGraduateTraineeCandidate({
        headline: "DevOps Engineer",
        career_stage: "unknown",
        career_stage_confidence: 0,
        years_required_min: null,
        is_grad_program: false,
      }),
    ).toBe(false);

    expect(
      isGraduateTraineeCandidate({
        headline: "Junior Backend Engineer",
        career_stage: "junior",
        career_stage_confidence: 0.85,
        years_required_min: null,
        is_grad_program: false,
      }),
    ).toBe(true);

    expect(
      isGraduateTraineeCandidate({
        headline: "Experienced Computer Vision Engineer",
        career_stage: "unknown",
        career_stage_confidence: 0.2,
        years_required_min: null,
        is_grad_program: false,
      }),
    ).toBe(false);
  });

  it("renders explore shell without crashing", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Jobs />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Explore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "High Signal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For You" })).toBeInTheDocument();
  });

  it("opens a populated job detail panel without crashing", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Jobs />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const jobTitle = await screen.findByText("Backend Engineer");
    fireEvent.click(jobTitle);

    expect(await screen.findByText("Track")).toBeInTheDocument();
    expect(screen.getByText("Match analysis")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
  });
});
