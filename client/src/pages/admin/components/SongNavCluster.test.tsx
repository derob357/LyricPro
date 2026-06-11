import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SONG_NAV_KEY, type SongNavState } from "./SongNavCluster";

// ── wouter mock ────────────────────────────────────────────────────────────────
const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/admin/songs/20", navigate] };
});

import { SongNavCluster } from "./SongNavCluster";

const NAV_IDS = [10, 20, 30, 40];
const navState: SongNavState = {
  ids: NAV_IDS,
  label: "Search: 'love'",
};

function seedSessionStorage(state: SongNavState = navState) {
  sessionStorage.setItem(SONG_NAV_KEY, JSON.stringify(state));
}

describe("SongNavCluster", () => {
  beforeEach(() => {
    navigate.mockClear();
    sessionStorage.clear();
  });

  // ── (b) no key → no cluster ────────────────────────────────────────────────
  it("renders nothing when sessionStorage key is absent", () => {
    const { container } = render(<SongNavCluster currentId={20} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the current id is not in the stored list", () => {
    seedSessionStorage({ ids: [1, 2, 3], label: "All songs" });
    const { container } = render(<SongNavCluster currentId={99} />);
    expect(container.firstChild).toBeNull();
  });

  // ── (a) seeded list, id present ────────────────────────────────────────────
  it("renders the nav cluster when currentId is in the list", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={20} />);
    expect(screen.getByTestId("song-nav-cluster")).toBeTruthy();
  });

  it("shows correct position text", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={20} />);
    // id=20 is index 1 → "2 of 4"
    expect(screen.getByTestId("song-nav-position").textContent).toMatch(/2 of 4/);
  });

  it("shows the label from sessionStorage", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={20} />);
    expect(screen.getByTestId("song-nav-label").textContent).toContain("Search: 'love'");
  });

  it("Prev is enabled and Next is enabled for a middle id", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={20} />);
    const prev = screen.getByTestId("song-nav-prev");
    const next = screen.getByTestId("song-nav-next");
    expect((prev as HTMLButtonElement).disabled).toBe(false);
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it("Prev is disabled for the first id", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={10} />);
    expect((screen.getByTestId("song-nav-prev") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("song-nav-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Next is disabled for the last id", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={40} />);
    expect((screen.getByTestId("song-nav-prev") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("song-nav-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicking Next navigates to the adjacent id", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={20} />);
    fireEvent.click(screen.getByTestId("song-nav-next"));
    // id=20 is index 1; next is NAV_IDS[2] = 30
    expect(navigate).toHaveBeenCalledWith("/admin/songs/30");
  });

  it("clicking Prev navigates to the adjacent id", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={20} />);
    fireEvent.click(screen.getByTestId("song-nav-prev"));
    // id=20 is index 1; prev is NAV_IDS[0] = 10
    expect(navigate).toHaveBeenCalledWith("/admin/songs/10");
  });

  it("clicking disabled Prev does not navigate", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={10} />);
    fireEvent.click(screen.getByTestId("song-nav-prev"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clicking disabled Next does not navigate", () => {
    seedSessionStorage();
    render(<SongNavCluster currentId={40} />);
    fireEvent.click(screen.getByTestId("song-nav-next"));
    expect(navigate).not.toHaveBeenCalled();
  });

  // ── onBeforeNavigate guard ─────────────────────────────────────────────────

  it("onBeforeNavigate returning false blocks navigation", () => {
    seedSessionStorage();
    const onBeforeNavigate = vi.fn(() => false);
    render(<SongNavCluster currentId={20} onBeforeNavigate={onBeforeNavigate} />);
    fireEvent.click(screen.getByTestId("song-nav-next"));
    expect(onBeforeNavigate).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("onBeforeNavigate returning true allows navigation", () => {
    seedSessionStorage();
    const onBeforeNavigate = vi.fn(() => true);
    render(<SongNavCluster currentId={20} onBeforeNavigate={onBeforeNavigate} />);
    fireEvent.click(screen.getByTestId("song-nav-next"));
    expect(onBeforeNavigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/admin/songs/30");
  });
});
