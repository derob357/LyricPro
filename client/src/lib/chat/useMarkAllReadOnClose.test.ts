// Pins the contract: calling the function returned by useMarkAllReadOnClose
// triggers chat.markAllRead.mutateAsync then invalidates chat.unreadCounts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---- Mock trpc -------------------------------------------------------
// mutateAsync is a spy we can track; we return a resolved promise so the
// fire-and-forget path in the hook can proceed synchronously in tests.
const mutateAsync = vi.fn().mockResolvedValue(undefined);
const invalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    chat: {
      markAllRead: {
        useMutation: () => ({ mutateAsync }),
      },
    },
    useUtils: () => ({
      chat: {
        unreadCounts: { invalidate },
      },
    }),
  },
}));

import { useMarkAllReadOnClose } from "./useMarkAllReadOnClose";

describe("useMarkAllReadOnClose", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    invalidate.mockClear();
  });

  it("returns a stable function reference across re-renders", () => {
    const { result, rerender } = renderHook(() => useMarkAllReadOnClose());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("calls markAllRead.mutateAsync when invoked", async () => {
    const { result } = renderHook(() => useMarkAllReadOnClose());
    await act(async () => {
      result.current();
      // Flush the microtask queue so the async IIFE resolves.
      await Promise.resolve();
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("invalidates chat.unreadCounts after markAllRead resolves", async () => {
    const { result } = renderHook(() => useMarkAllReadOnClose());
    await act(async () => {
      result.current();
      // Two microtask ticks: one for mutateAsync, one for invalidate.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not throw when mutateAsync rejects (fire-and-forget)", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("network error"));
    const { result } = renderHook(() => useMarkAllReadOnClose());
    await expect(
      act(async () => {
        result.current();
        await Promise.resolve();
        await Promise.resolve();
      }),
    ).resolves.toBeUndefined();
  });
});
