import { describe, it, expect } from "vitest";
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
});
