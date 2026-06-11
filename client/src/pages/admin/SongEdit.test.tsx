/**
 * SongEdit — infinite render loop regression test.
 *
 * Root cause: SectionIdentity/Licensing/Notes called onRegister() during the
 * render phase; the parent's onRegister handler called notifyDirty() which
 * is a setState that always produces a new value → render → register → setState
 * → render → …
 *
 * Fix: sections call onRegister() inside a useEffect (after render); the parent
 * only calls notifyDirty() when the dirty bit actually changes.
 *
 * Mocks:
 *   - wouter: useParams (id = "7"), useLocation
 *   - @/_core/hooks/useAuth: admin user
 *   - @/lib/trpc: adminSongs.get + adminSongs.update/disable/enable,
 *                 adminGenres.list, adminVariants.update/create
 *   - sub-components that pull in additional trpc hooks: VariantEditor,
 *     SongNavCluster, SongwriterEditor, PublisherEditor
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── wouter ────────────────────────────────────────────────────────────────────
const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useParams: () => ({ id: "7" }),
    useLocation: () => ["/admin/songs/7", navigate],
  };
});

// ── useAuth: admin user ───────────────────────────────────────────────────────
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, role: "admin" },
    isAuthenticated: true,
  }),
}));

// ── trpc ──────────────────────────────────────────────────────────────────────
const updateMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const refetchSong = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const songData = vi.hoisted(() => ({
  value: {
    id: 7,
    title: "Bohemian Rhapsody",
    artistName: "Queen",
    featuredArtist: null,
    genre: "Rock",
    subgenre: null,
    releaseYear: 1975,
    iswc: null,
    isrc: null,
    lyricSourceProvider: "internal" as const,
    providerTrackId: null,
    songwriters: [],
    publishers: [],
    approvedForGame: true,
    inCuratedBank: false,
    isActive: true,
    curatorNotes: null,
    lyricVariants: [],
    lyricSectionType: "verse",
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminSongs: {
      get: {
        useQuery: () => ({
          data: songData.value,
          refetch: refetchSong,
          isLoading: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: updateMutateAsync,
          isPending: false,
        }),
      },
      disable: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void }) => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
      enable: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void }) => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
    adminGenres: {
      list: {
        useQuery: () => ({ data: [] }),
      },
    },
    adminVariants: {
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

// ── Stub SongNavCluster (reads sessionStorage + wouter internally) ─────────────
vi.mock("./components/SongNavCluster", () => ({
  SongNavCluster: () => null,
}));

import SongEdit from "./SongEdit";

describe("SongEdit — infinite render loop regression", () => {
  beforeEach(() => {
    navigate.mockClear();
    sessionStorage.clear();
    updateMutateAsync.mockClear();
    refetchSong.mockClear();
  });

  // ── Test 1 (RED before fix): render must not throw ─────────────────────────
  it("renders without throwing a Maximum update depth exceeded error", async () => {
    // Before the fix this throws React's "Maximum update depth exceeded"
    // because sections call onRegister during render while the parent's
    // notifyDirty calls setState on every registration — infinite loop.
    await act(async () => {
      render(<SongEdit />);
    });
    // If we get here without an error, the loop is gone.
    // The page should show the song title.
    expect(screen.getByText("Bohemian Rhapsody")).toBeTruthy();
  });

  // ── Test 2 (post-fix behavior): editing a field enables the Save button ────
  it("editing a field flips the Save button from disabled to enabled", async () => {
    await act(async () => {
      render(<SongEdit />);
    });

    // Save button starts disabled (no dirty sections)
    const saveBtn = screen.getByTestId("page-save-btn");
    expect(saveBtn).toBeTruthy();
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // Edit the title input — changes identity section's dirty bit
    const titleInput = screen.getByDisplayValue("Bohemian Rhapsody");
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: "Bohemian Rhapsody (Edit)" } });
    });

    // After a dirty change the parent re-renders and enables Save
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
