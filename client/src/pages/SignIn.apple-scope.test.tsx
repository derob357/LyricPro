import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignIn from "./SignIn";

// Mocks must be defined inside factory to avoid hoisting issues.
// We use vi.hoisted to expose the mock fn outside the factory.
const { signInWithOAuth } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithOAuth,
      sendMagicLink: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/signin", vi.fn()],
  };
});

// Mock trpc — SignIn uses sendMagicLink and devGenerateMagicLink mutations
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      sendMagicLink: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
      sendPasswordReset: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
      devGenerateMagicLink: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/lib/platform", () => ({
  IS_NATIVE: false,
}));

vi.mock("@/lib/deepLink", () => ({
  AUTH_CALLBACK_URL: "lyricpro://auth/callback",
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("SignIn — Apple OAuth scopes", () => {
  beforeEach(() => {
    signInWithOAuth.mockClear();
  });

  it("requests 'name email' scopes when signing in with Apple", async () => {
    render(<SignIn />);
    const appleBtn = screen.getByRole("button", { name: /apple/i });
    fireEvent.click(appleBtn);
    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "apple",
          options: expect.objectContaining({ scopes: "name email" }),
        })
      );
    });
  });

  it("does NOT pass scopes when signing in with Google", async () => {
    signInWithOAuth.mockClear();
    render(<SignIn />);
    fireEvent.click(screen.getByRole("button", { name: /google/i }));
    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "google",
          options: expect.not.objectContaining({ scopes: expect.anything() }),
        })
      );
    });
  });
});
