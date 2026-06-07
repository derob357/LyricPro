import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});

import Interstitial from "./Interstitial";

describe("Interstitial (stub)", () => {
  it("MyDashboard navigates to /welcome", () => {
    render(<Interstitial />);
    screen.getByTestId("mydashboard-btn").click();
    expect(navigate).toHaveBeenCalledWith("/welcome");
  });
});
