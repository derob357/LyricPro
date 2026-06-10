import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import AnimatedGnBalance from "./AnimatedGnBalance";

describe("AnimatedGnBalance", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the value and tweens to a new one", () => {
    const { rerender } = render(<AnimatedGnBalance value={100} />);
    expect(screen.getByTestId("gn-balance").textContent).toBe("100");
    rerender(<AnimatedGnBalance value={125} />);
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByTestId("gn-balance").textContent).toBe("125");
  });

  it("shows a floating +delta indicator on increase, −delta on decrease", () => {
    const { rerender } = render(<AnimatedGnBalance value={100} />);
    rerender(<AnimatedGnBalance value={125} />);
    expect(screen.getByTestId("gn-delta").textContent).toContain("+25");
    rerender(<AnimatedGnBalance value={75} />);
    expect(screen.getByTestId("gn-delta").textContent).toContain("-50");
  });

  it("reduced motion: jumps instantly, still shows the delta", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any;
    const { rerender } = render(<AnimatedGnBalance value={100} />);
    rerender(<AnimatedGnBalance value={150} />);
    expect(screen.getByTestId("gn-balance").textContent).toBe("150");
  });
});
