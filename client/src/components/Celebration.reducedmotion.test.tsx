import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock sharedAudio to return null so jsdom doesn't try to instantiate AudioContext
vi.mock("@/lib/sharedAudio", () => ({
  getSharedAudioContext: () => null,
  unlockAudioOnGesture: () => {},
}));

import Celebration from "./Celebration";

describe("Celebration — reduced-motion path", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    originalMatchMedia = window.matchMedia;
    // Report prefers-reduced-motion: reduce for all queries
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it("calls onComplete after ~800ms when reduced motion is active", () => {
    const onComplete = vi.fn();
    render(<Celebration level={1} muted={true} onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not start a canvas animation when reduced motion is active", () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const onComplete = vi.fn();
    render(<Celebration level={1} muted={true} onComplete={onComplete} />);
    // Advance past the reduced-motion timer to ensure any deferred canvas work would have run
    vi.advanceTimersByTime(900);
    expect(getContextSpy).not.toHaveBeenCalled();
    getContextSpy.mockRestore();
  });

  it("renders message text instead of generic label when message prop is provided", () => {
    const message = "Three out of four — that's a strong round";
    render(<Celebration level={1} muted={true} message={message} />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText("Not bad!")).toBeNull();
    expect(screen.getByText(/Tap anywhere to continue/i)).toBeTruthy();
  });

  it("renders generic label when message prop is absent", () => {
    render(<Celebration level={1} muted={true} />);
    expect(screen.getByText("Not bad!")).toBeTruthy();
    expect(screen.getByText(/Tap anywhere to continue/i)).toBeTruthy();
  });
});
