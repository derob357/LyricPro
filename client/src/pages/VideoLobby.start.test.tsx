/**
 * VideoLobby — host Start button wiring test.
 *
 * Mocks:
 *   - wouter: useLocation + useParams (inviteCode = "INVITE1")
 *   - @/lib/trpc: joinLiveRoom.useMutation, match.getMatchState.useQuery,
 *     match.startMatch.useMutation, game.setReady.useMutation
 *   - @/lib/livekit/useLiveKitRoom: returns idle/neutral values (no WebRTC)
 *   - @/components/livekit/VideoGrid: no-op div
 *   - @/components/livekit/PermissionGate: immediately calls onGranted so
 *     VideoLobby skips the permission screen
 *   - @/_core/hooks/useAuth: returns a host user (id 42)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── wouter mocks ───────────────────────────────────────────────────────────────
const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/lobby/live/INVITE1", navigate],
    useParams: () => ({ inviteCode: "INVITE1" }),
  };
});

// ── trpc mutation / query mocks ────────────────────────────────────────────────
const startMatchMutateAsync = vi.hoisted(() => vi.fn());
const setReadyMutateAsync = vi.hoisted(() => vi.fn());
const joinLiveRoomMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    liveRoom: {
      joinLiveRoom: {
        useMutation: () => ({ mutateAsync: joinLiveRoomMutateAsync }),
      },
    },
    match: {
      startMatch: {
        useMutation: () => ({
          mutateAsync: startMatchMutateAsync,
          isPending: false,
        }),
      },
      getMatchState: {
        useQuery: () => ({
          data: {
            room: {
              roomCode: "ROOM01",
              status: "waiting",
              hostUserId: 42,
            },
            players: [
              { id: 1, userId: 42, isReady: true, guestName: null },
              { id: 2, userId: 99, isReady: true, guestName: null },
            ],
          },
          isLoading: false,
        }),
      },
    },
    game: {
      setReady: {
        useMutation: () => ({ mutateAsync: setReadyMutateAsync, isPending: false }),
      },
    },
  },
}));

// ── useAuth mock: local user is host (id 42) ───────────────────────────────────
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 42, firstName: "Host" }, isAuthenticated: true }),
}));

// ── LiveKit mock: skip WebRTC entirely ─────────────────────────────────────────
vi.mock("@/lib/livekit/useLiveKitRoom", () => ({
  useLiveKitRoom: () => ({
    room: null,
    participants: [],
    status: "idle",
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

// ── Component mocks ────────────────────────────────────────────────────────────
vi.mock("@/components/livekit/VideoGrid", () => ({
  VideoGrid: () => <div data-testid="video-grid" />,
}));

vi.mock("@/components/livekit/PermissionGate", () => ({
  // Calls onGranted inside a useEffect so React doesn't warn about setState
  // during render of a sibling component.
  PermissionGate: ({ onGranted }: { onGranted: () => void }) => {
    const { useEffect } = require("react");
    useEffect(() => { onGranted(); }, []);
    return null;
  },
}));

import VideoLobby from "./VideoLobby";

describe("VideoLobby — host Start button", () => {
  beforeEach(() => {
    navigate.mockClear();
    startMatchMutateAsync
      .mockReset()
      .mockResolvedValue({ ok: true, currentRound: 1, roundEndsAt: new Date() });
    setReadyMutateAsync.mockReset().mockResolvedValue({ success: true });
    joinLiveRoomMutateAsync.mockReset().mockResolvedValue({
      roomId: 1,
      roomCode: "ROOM01",
      videoRoomName: "room-abc",
      livekitUrl: "wss://test",
      token: "tok123",
    });
  });

  it("renders a Start button for the host when all players are ready", async () => {
    render(<VideoLobby />);
    // The PermissionGate fires onGranted synchronously; joinLiveRoom is then
    // called asynchronously. Wait for the lobby main view.
    await waitFor(() => expect(joinLiveRoomMutateAsync).toHaveBeenCalled());
    expect(await screen.findByTestId("lobby-start")).toBeTruthy();
  });

  it("clicking Start calls startMatch.mutateAsync then navigates to /match/ROOM01", async () => {
    render(<VideoLobby />);
    await waitFor(() => expect(joinLiveRoomMutateAsync).toHaveBeenCalled());

    const startBtn = await screen.findByTestId("lobby-start");
    fireEvent.click(startBtn);

    await waitFor(() =>
      expect(startMatchMutateAsync).toHaveBeenCalledWith({ roomCode: "ROOM01" }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/match/ROOM01"),
    );
  });
});
