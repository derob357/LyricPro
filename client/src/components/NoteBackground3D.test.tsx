import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { NoteBackground3D } from "./NoteBackground3D";

describe("NoteBackground3D", () => {
  it("renders the golden-note asset, decorative and non-interactive", () => {
    const { getByTestId } = render(<NoteBackground3D />);
    const img = getByTestId("note-bg-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("golden-note.svg");
    expect(img.getAttribute("aria-hidden")).toBe("true");
    const root = getByTestId("note-bg-root");
    expect(root.className).toContain("pointer-events-none");
  });

  it("does not attach a mousemove listener under prefers-reduced-motion", () => {
    const originalMM = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const addSpy = vi.spyOn(window, "addEventListener");
    render(<NoteBackground3D />);
    expect(addSpy).not.toHaveBeenCalledWith("mousemove", expect.any(Function));
    addSpy.mockRestore();
    window.matchMedia = originalMM;
  });
});
