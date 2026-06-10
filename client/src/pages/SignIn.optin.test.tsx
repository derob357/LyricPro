import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SignIn from "./SignIn";

// Reuse the same mock patterns from SignIn.apple-scope.test.tsx
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      sendMagicLink: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// Mock wouter — useSearch provides the query string for mode detection
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/signin", vi.fn()],
    useSearch: vi.fn(() => ""),
  };
});

// Mock trpc — include setMarketingConsent alongside existing mutations
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
      setMarketingConsent: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
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

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("SignIn — marketing opt-in checkbox", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the opt-in checkbox in signup mode (?mode=signup)", async () => {
    const { useSearch } = await import("wouter");
    vi.mocked(useSearch).mockReturnValue("?mode=signup");

    render(<SignIn />);

    const checkbox = screen.getByTestId("signup-optin");
    expect(checkbox).toBeTruthy();
    // Radix Checkbox renders with data-state="unchecked" by default
    expect(checkbox.getAttribute("data-state")).toBe("unchecked");
  });

  it("sets localStorage key on check and removes it on uncheck", async () => {
    const { useSearch } = await import("wouter");
    vi.mocked(useSearch).mockReturnValue("?mode=signup");

    render(<SignIn />);

    const checkbox = screen.getByTestId("signup-optin");

    // Initially not set
    expect(localStorage.getItem("lyricpro_pending_optin")).toBeNull();

    // Click once — should check and set the key
    fireEvent.click(checkbox);
    expect(localStorage.getItem("lyricpro_pending_optin")).toBe("signup-form");

    // Click again — should uncheck and remove the key
    fireEvent.click(checkbox);
    expect(localStorage.getItem("lyricpro_pending_optin")).toBeNull();
  });

  it("does NOT render the opt-in checkbox in sign-in mode", async () => {
    const { useSearch } = await import("wouter");
    vi.mocked(useSearch).mockReturnValue("");

    render(<SignIn />);

    expect(screen.queryByTestId("signup-optin")).toBeNull();
  });
});
