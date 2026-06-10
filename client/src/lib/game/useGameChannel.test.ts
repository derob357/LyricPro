import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { channel, removeChannel, channelFn } = vi.hoisted(() => {
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  const removeChannel = vi.fn();
  const channelFn = vi.fn(() => channel);
  return { channel, removeChannel, channelFn };
});

vi.mock("@/lib/supabase", () => ({ supabase: { channel: channelFn, removeChannel } }));

import { useGameChannel } from "./useGameChannel";

describe("useGameChannel", () => {
  it("subscribes to game:{roomId} private channel and registers the four broadcast handlers", () => {
    const onEvent = vi.fn();
    renderHook(() => useGameChannel(42, onEvent));
    expect(channelFn).toHaveBeenCalledWith("game:42", { config: { private: true } });
    const events = channel.on.mock.calls.map((c) => c[1].event);
    expect(events).toEqual(expect.arrayContaining(["round_started", "player_answered", "round_revealed", "match_complete"]));
    expect(channel.subscribe).toHaveBeenCalled();
  });
  it("no-ops for null roomId (does not open a channel)", () => {
    channelFn.mockClear();
    renderHook(() => useGameChannel(null, vi.fn()));
    expect(channelFn).not.toHaveBeenCalled();
  });
});
