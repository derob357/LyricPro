import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProfileCompletion from "./ProfileCompletion";

// -------------------------------------------------------------------
// Mock: wouter
// -------------------------------------------------------------------
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/profile-completion", vi.fn()],
  };
});

// -------------------------------------------------------------------
// Mock: trpc — updateProfile + setMarketingConsent + useUtils
// -------------------------------------------------------------------
const mockConsentMutate = vi.fn();
const mockUpdateProfileMutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      auth: { me: { invalidate: vi.fn().mockResolvedValue(undefined) } },
    }),
    auth: {
      updateProfile: {
        useMutation: () => ({
          mutate: mockUpdateProfileMutate,
          isPending: false,
        }),
      },
      setMarketingConsent: {
        useMutation: () => ({
          mutate: mockConsentMutate,
          isPending: false,
        }),
      },
    },
  },
}));

// -------------------------------------------------------------------
// Mock: useAuth — authenticated user with no firstName (triggers form)
// -------------------------------------------------------------------
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { email: "test@example.com", name: "Test User", firstName: null },
    isAuthenticated: true,
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

// -------------------------------------------------------------------
// Mock: sonner toast
// -------------------------------------------------------------------
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// -------------------------------------------------------------------
// Mock: framer-motion — render children directly
// -------------------------------------------------------------------
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
  },
}));

describe("ProfileCompletion — consent touched guard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("does NOT call setMarketingConsent when checkbox is never touched", () => {
    render(<ProfileCompletion />);

    // Fill required first name so submit is enabled
    const firstNameInput = screen.getByPlaceholderText("e.g. Jamie");
    fireEvent.change(firstNameInput, { target: { value: "Jamie" } });

    // Click submit without ever touching the checkbox
    const submitButton = screen.getByRole("button", { name: /save & start playing/i });
    fireEvent.click(submitButton);

    expect(mockConsentMutate).not.toHaveBeenCalled();
    expect(mockUpdateProfileMutate).toHaveBeenCalledOnce();
  });

  it("calls setMarketingConsent with current state when checkbox has been touched", () => {
    render(<ProfileCompletion />);

    // Fill required first name
    const firstNameInput = screen.getByPlaceholderText("e.g. Jamie");
    fireEvent.change(firstNameInput, { target: { value: "Jamie" } });

    // Touch the checkbox (click on)
    const checkbox = screen.getByTestId("completion-optin");
    fireEvent.click(checkbox);

    // Submit
    const submitButton = screen.getByRole("button", { name: /save & start playing/i });
    fireEvent.click(submitButton);

    expect(mockConsentMutate).toHaveBeenCalledOnce();
    expect(mockConsentMutate).toHaveBeenCalledWith(
      expect.objectContaining({ source: "profile-completion" }),
      expect.anything()
    );
    expect(mockUpdateProfileMutate).toHaveBeenCalledOnce();
  });
});
