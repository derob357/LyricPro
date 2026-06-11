import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── trpc mock ──────────────────────────────────────────────────────────────────
// Capture the mutate spy so tests can assert on it.
const updateMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminVariants: {
      update: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void }) => ({
          mutate: updateMutate,
          isPending: false,
        }),
      },
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
    updateMutate.mockClear();
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

  it("clicking 'High' pill and saving calls adminVariants.update with patch.difficulty === 'high'", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[baseVariant]}
        onChanged={() => {}}
      />,
    );
    const highPill = screen.getByTestId("variant-difficulty-0-high");
    fireEvent.click(highPill);

    const saveBtn = screen.getByRole("button", { name: /save variant/i });
    fireEvent.click(saveBtn);

    expect(updateMutate).toHaveBeenCalledOnce();
    const call = updateMutate.mock.calls[0][0];
    expect(call.songId).toBe(SONG_ID);
    expect(call.variantIndex).toBe(0);
    expect(call.patch.difficulty).toBe("high");
  });

  it("clicking Inherit pill (clearing difficulty) sends patch.difficulty === null", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[taggedVariant]}
        onChanged={() => {}}
      />,
    );
    // click Inherit to clear from "high"
    const inheritPill = screen.getByTestId("variant-difficulty-0-inherit");
    fireEvent.click(inheritPill);

    const saveBtn = screen.getByRole("button", { name: /save variant/i });
    fireEvent.click(saveBtn);

    expect(updateMutate).toHaveBeenCalledOnce();
    const call = updateMutate.mock.calls[0][0];
    expect(call.patch.difficulty).toBeNull();
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
