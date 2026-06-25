import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { OverviewSignalStrip } from "@/components/overview/OverviewSignalStrip";

describe("OverviewSignalStrip", () => {
  it("shows a calm catch-up line when all stats are hidden", () => {
    render(<OverviewSignalStrip items={[]} />);
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it("renders a compact inline strip for non-zero stats", () => {
    render(
      <MemoryRouter>
        <OverviewSignalStrip
          items={[
            {
              label: "Due today",
              rawValue: 2,
              value: 2,
              href: "/jobs?deadline=today",
            },
            {
              label: "Alerts",
              rawValue: 1,
              value: 1,
              href: "/searches",
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Due today/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alerts/i })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
