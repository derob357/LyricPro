import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── trpc mock ──────────────────────────────────────────────────────────────────
// Only the delete mutation is needed now; update is no longer called from VariantEditor.
const deleteMutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminVariants: {
      delete: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void }) => ({
          mutate: deleteMutate,
          isPending: false,
        }),
      },
    },
  },
}));

import { VariantEditor } from "./VariantEditor";
import type { Variant, VariantDraftEntry } from "./VariantEditor";

const SONG_ID = 42;

const baseVariant: Variant = {
  prompt: "Ain't no mountain high",
  answer: "enough",
  distractors: ["too low", "so wide"],
  sectionType: "chorus",
};

const taggedVariant: Variant = {
  ...baseVariant,
  difficulty: "high",
};

describe("VariantEditor", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
  });

  it("renders a variant card with the difficulty pills defaulting to Inherit selected", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[baseVariant]}
        onChanged={() => {}}
      />,
    );
    const container = screen.getByTestId("variant-difficulty-0");
    expect(container).toBeTruthy();
    const inheritPill = screen.getByTestId("variant-difficulty-0-inherit");
    expect(inheritPill.textContent).toMatch(/inherit/i);
    // Inherit pill should carry the selected style (border-primary class)
    expect(inheritPill.className).toMatch(/border-primary/);
  });

  it("when variant already has difficulty='high', the high pill is selected", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[taggedVariant]}
        onChanged={() => {}}
      />,
    );
    const highPill = screen.getByTestId("variant-difficulty-0-high");
    // Selected high pill carries the red accent style
    expect(highPill.className).toMatch(/border-red-500/);
  });

  it("no Save button exists inside variant cards", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[baseVariant]}
        onChanged={() => {}}
      />,
    );
    // There must be no button with a save-variant label
    expect(screen.queryByRole("button", { name: /save variant/i })).toBeNull();
  });

  it("clicking 'High' pill stages patch.difficulty === 'high' via onDirtyChange", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    await act(async () => {
      render(
        <VariantEditor
          songId={SONG_ID}
          variants={[baseVariant]}
          onChanged={() => {}}
          onDirtyChange={onDirtyChange}
        />,
      );
    });

    const highPill = screen.getByTestId("variant-difficulty-0-high");
    await act(async () => {
      fireEvent.click(highPill);
    });

    const latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries[0].dirty).toBe(true);
    const patch = latestEntries[0].buildPatch();
    expect(patch.difficulty).toBe("high");
  });

  it("clicking Inherit pill (clearing difficulty) stages patch.difficulty === null via onDirtyChange", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    await act(async () => {
      render(
        <VariantEditor
          songId={SONG_ID}
          variants={[taggedVariant]}
          onChanged={() => {}}
          onDirtyChange={onDirtyChange}
        />,
      );
    });

    // click Inherit to clear from "high"
    const inheritPill = screen.getByTestId("variant-difficulty-0-inherit");
    await act(async () => {
      fireEvent.click(inheritPill);
    });

    const latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries[0].dirty).toBe(true);
    const patch = latestEntries[0].buildPatch();
    expect(patch.difficulty).toBeNull();
  });

  it("preview shows the prompt and answer text", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[baseVariant]}
        onChanged={() => {}}
      />,
    );
    // The Preview block renders a <p> containing prompt + "..." + answer.
    // Use the PREVIEW label as an anchor to scope the assertion.
    const preview = screen.getByText(/preview/i);
    expect(preview).toBeTruthy();
    // The prompt text appears inside the preview paragraph.
    const previewPara = preview.nextElementSibling as HTMLElement;
    expect(previewPara.textContent).toContain("Ain't no mountain high");
    expect(previewPara.textContent).toContain("enough");
  });

  // ── onDirtyChange contract ────────────────────────────────────────────────

  it("onDirtyChange is called on mount with dirty=false for each variant", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    await act(async () => {
      render(
        <VariantEditor
          songId={SONG_ID}
          variants={[baseVariant]}
          onChanged={() => {}}
          onDirtyChange={onDirtyChange}
        />,
      );
    });
    expect(onDirtyChange).toHaveBeenCalled();
    const latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries).toHaveLength(1);
    expect(latestEntries[0].dirty).toBe(false);
  });

  it("onDirtyChange reports dirty=true after editing a field, and buildPatch returns updated values", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    await act(async () => {
      render(
        <VariantEditor
          songId={SONG_ID}
          variants={[baseVariant]}
          onChanged={() => {}}
          onDirtyChange={onDirtyChange}
        />,
      );
    });

    // Edit the answer field
    const answerInput = screen.getByDisplayValue("enough");
    await act(async () => {
      fireEvent.change(answerInput, { target: { value: "never" } });
    });

    const latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries[0].dirty).toBe(true);
    const patch = latestEntries[0].buildPatch();
    expect(patch.answer).toBe("never");
  });
});
