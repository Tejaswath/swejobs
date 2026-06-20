import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import Applications from "@/pages/Applications";

const supabase = vi.hoisted(() => {
  const applicationRows = [
    {
      id: "application-active",
      user_id: "user-1",
      request_id: "swejobs-user-1-1",
      job_id: 1,
      company: "Active AB",
      job_title: "Backend Engineer",
      job_url: "https://example.com/active",
      status: "applied",
      applied_at: "2026-06-01T12:00:00Z",
      notes: null,
      resume_label: null,
      resume_version_id: null,
      ats_score: null,
      ats_keywords_json: null,
      ats_job_description: null,
      status_history: [],
      source: "swejobs",
      created_at: "2026-06-01T12:00:00Z",
      updated_at: "2026-06-01T12:00:00Z",
    },
    {
      id: "application-rejected",
      user_id: "user-1",
      request_id: null,
      job_id: null,
      company: "Archived AB",
      job_title: "Frontend Engineer",
      job_url: "https://example.com/archived",
      status: "rejected",
      applied_at: "2026-05-01T12:00:00Z",
      notes: null,
      resume_label: null,
      resume_version_id: null,
      ats_score: null,
      ats_keywords_json: null,
      ats_job_description: null,
      status_history: [],
      source: "manual",
      created_at: "2026-05-01T12:00:00Z",
      updated_at: "2026-05-10T12:00:00Z",
    },
  ];
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
    from: (table: string) => createThenableBuilder({
      data: table === "applications" ? applicationRows : [],
      error: null,
      count: table === "applications" ? applicationRows.length : 0,
    }),
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

describe("Applications page", () => {
  it("renders tracker shell and actions without crashing", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Applications />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Applications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Application/i })).toBeInTheDocument();
    expect(screen.getByText("Awaiting response")).toBeInTheDocument();
    expect(screen.getByText("Follow-up due")).toBeInTheDocument();
    expect(screen.getByText("Active this week")).toBeInTheDocument();
    const showArchived = await screen.findByRole("button", { name: "Show archived (1)" });
    expect(screen.queryByText("Archived AB")).not.toBeInTheDocument();

    fireEvent.click(showArchived);
    expect(await screen.findByText("Archived AB")).toBeInTheDocument();
  });
});
