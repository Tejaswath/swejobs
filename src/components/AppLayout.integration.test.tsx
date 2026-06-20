import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppLayout } from "@/components/AppLayout";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com" },
    signOut: vi.fn(),
  }),
}));

describe("AppLayout navigation", () => {
  it("keeps the core loop primary and authenticated utilities under More", async () => {
    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <AppLayout>
          <div>Page content</div>
        </AppLayout>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: "Saved Jobs" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Skill Gap")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(await screen.findByRole("link", { name: "Outreach" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
  });
});
