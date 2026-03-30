import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import Jobs from "@/pages/Jobs";

const supabase = vi.hoisted(() => {
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
    from: () => createThenableBuilder({ data: [], error: null, count: 0 }),
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
    expect(screen.getByRole("button", { name: "Recommended" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All Roles" })).toBeInTheDocument();
  });
});
