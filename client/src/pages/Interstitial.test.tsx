import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return { ...actual, useLocation: () => ["/", navigate] };
});

const authState = vi.hoisted(() => ({ value: { user: null as any, isAuthenticated: false } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));

const createGuestSession = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const createRoom = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      createGuestSession: { useMutation: () => createGuestSession },
      createRoom: { useMutation: () => createRoom },
    },
  },
}));

import Interstitial from "./Interstitial";

function selectGenreAndDecade() {
  // Genre uses a native <select> for testability (see note in implementation).
  fireEvent.change(screen.getByTestId("genre-trigger"), { target: { value: "Pop" } });
  // Decade multi-select popover
  fireEvent.click(screen.getByTestId("decade-trigger"));
  fireEvent.click(screen.getByTestId("decade-opt-1990–2000"));
}

describe("Interstitial Play Now", () => {
  beforeEach(() => {
    navigate.mockClear();
    createGuestSession.mutateAsync.mockReset().mockResolvedValue({ token: "guest-tok", nickname: "jamie" });
    createRoom.mutateAsync.mockReset().mockResolvedValue({ roomCode: "ROOM42" });
    authState.value = { user: null, isAuthenticated: false };
    localStorage.clear();
  });

  it("disables Start until email + genre + decade are all set (guest)", () => {
    render(<Interstitial />);
    const start = screen.getByTestId("play-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    expect(start.disabled).toBe(true);
    selectGenreAndDecade();
    expect(start.disabled).toBe(false);
  });

  it("guest flow: guest session + 3-round low/90s solo room + navigate", async () => {
    render(<Interstitial />);
    fireEvent.change(screen.getByTestId("email-input"), { target: { value: "jamie@example.com" } });
    selectGenreAndDecade();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).toHaveBeenCalledWith({ email: "jamie@example.com" });
    expect(localStorage.getItem("lyricpro_guest_token")).toBe("guest-tok");
    expect(localStorage.getItem("lyricpro_guest_email")).toBe("jamie@example.com");
    expect(createRoom.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      mode: "solo", genres: ["Pop"], decades: ["1990–2000"],
      difficulty: "low", timerSeconds: 90, rounds: 3, explicitFilter: false, guestToken: "guest-tok",
    }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/play/ROOM42"));
  });

  it("authenticated flow: no email field, no guest session, no guestToken", async () => {
    authState.value = { user: { id: "u1", firstName: "Sam" }, isAuthenticated: true };
    render(<Interstitial />);
    expect(screen.queryByTestId("email-input")).toBeNull();
    selectGenreAndDecade();
    fireEvent.click(screen.getByTestId("play-start"));
    await waitFor(() => expect(createRoom.mutateAsync).toHaveBeenCalled());
    expect(createGuestSession.mutateAsync).not.toHaveBeenCalled();
    expect(createRoom.mutateAsync.mock.calls[0][0].guestToken).toBeUndefined();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/play/ROOM42"));
  });

  it("MyDashboard navigates to /welcome", () => {
    render(<Interstitial />);
    fireEvent.click(screen.getByTestId("mydashboard-btn"));
    expect(navigate).toHaveBeenCalledWith("/welcome");
  });
});
