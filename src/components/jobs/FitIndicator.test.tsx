import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FitIndicator } from "@/components/jobs/FitIndicator";

describe("FitIndicator", () => {
  it("renders three filled segments for Strong fit", () => {
    const { container } = render(<FitIndicator label="Strong" score={82} />);
    const segments = container.querySelectorAll('[aria-hidden="true"] > span');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toHaveClass("bg-primary");
    expect(segments[1]).toHaveClass("bg-primary");
    expect(segments[2]).toHaveClass("bg-primary");
    expect(screen.getByLabelText("Strong fit, 82 of 100")).toBeInTheDocument();
  });

  it("renders one filled segment for Stretch fit", () => {
    const { container } = render(<FitIndicator label="Stretch" score={40} />);
    const segments = container.querySelectorAll('[aria-hidden="true"] > span');
    expect(segments[0]).toHaveClass("bg-muted-foreground/70");
    expect(segments[1]).toHaveClass("bg-muted-foreground/20");
    expect(segments[2]).toHaveClass("bg-muted-foreground/20");
  });
});
