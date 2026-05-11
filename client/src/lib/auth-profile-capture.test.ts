import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleFirstSignInProfile } from "./auth-profile-capture";

const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
const supabase = { auth: { updateUser } } as never;

describe("handleFirstSignInProfile", () => {
  beforeEach(() => {
    updateUser.mockClear();
    localStorage.clear();
  });

  it("captures full_name from Apple user_metadata on first sign-in", async () => {
    const session = {
      user: {
        id: "user-123",
        user_metadata: { full_name: "Jane Doe" },
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as never, supabase);
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "Jane Doe" } });
  });

  it("constructs full_name from given_name + family_name when not provided", async () => {
    const session = {
      user: {
        id: "user-456",
        user_metadata: { given_name: "John", family_name: "Smith" },
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as never, supabase);
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "John Smith" } });
  });

  it("does NOT call updateUser if user already profile-captured (localStorage flag)", async () => {
    localStorage.setItem("profile-captured-user-789", "1");
    const session = {
      user: {
        id: "user-789",
        user_metadata: { full_name: "Repeat User" },
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as never, supabase);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does NOT call updateUser when user_metadata has no name (subsequent Apple sign-in)", async () => {
    const session = {
      user: {
        id: "user-321",
        user_metadata: {},
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as never, supabase);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does nothing for non-Apple providers (Google, etc.)", async () => {
    const session = {
      user: {
        id: "user-555",
        user_metadata: { full_name: "Google User" },
        app_metadata: { provider: "google" },
      },
    };
    await handleFirstSignInProfile(session as never, supabase);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("sets the localStorage flag after capture so it doesn't fire twice", async () => {
    const session = {
      user: {
        id: "user-once",
        user_metadata: { full_name: "Once User" },
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as never, supabase);
    expect(localStorage.getItem("profile-captured-user-once")).toBe("1");
    updateUser.mockClear();
    await handleFirstSignInProfile(session as never, supabase);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
