import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef } from "react";

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
import type { Variant, VariantDraftEntry, VariantEditorHandle } from "./VariantEditor";

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

  // ── Staged-new variant tests ──────────────────────────────────────────────

  /**
   * Helper: render VariantEditor with a forwarded ref and return the ref.
   * We use a wrapper component so we can call ref.current.stageNew() from tests.
   */
  function renderWithRef(
    variants: Variant[],
    onDirtyChange?: (entries: VariantDraftEntry[]) => void,
    defaultSectionType = "chorus",
  ) {
    let capturedRef: React.RefObject<VariantEditorHandle | null> | null = null;

    function Wrapper() {
      const ref = useRef<VariantEditorHandle>(null);
      capturedRef = ref;
      return (
        <VariantEditor
          ref={ref}
          songId={SONG_ID}
          variants={variants}
          onChanged={() => {}}
          onDirtyChange={onDirtyChange}
          defaultSectionType={defaultSectionType}
        />
      );
    }

    render(<Wrapper />);
    return capturedRef!;
  }

  it("stageNew adds a new variant card with 'New — not saved yet' badge", async () => {
    const ref = renderWithRef([baseVariant]);

    await act(async () => {
      ref.current?.stageNew();
    });

    // The new card should render with a badge
    expect(screen.getByTestId("new-variant-card-2")).toBeTruthy();
    expect(screen.getByTestId("new-variant-badge-2")).toBeTruthy();
  });

  it("staged new card publishes isNew=true entry via onDirtyChange", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    const ref = renderWithRef([baseVariant], onDirtyChange);

    await act(async () => {
      ref.current?.stageNew();
    });

    const latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    // 1 existing + 1 new = 2 entries total
    expect(latestEntries).toHaveLength(2);
    expect(latestEntries[1].isNew).toBe(true);
    expect(latestEntries[1].dirty).toBe(true);
    expect(typeof latestEntries[1].buildCreatePayload).toBe("function");
  });

  it("unstaging a new card (X button) removes it from the registry", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    const ref = renderWithRef([baseVariant], onDirtyChange);

    await act(async () => {
      ref.current?.stageNew();
    });

    // Confirm it was added
    expect(screen.getByTestId("new-variant-card-2")).toBeTruthy();

    // Click the X button on the new card
    const removeBtn = screen.getByTestId("new-variant-remove-2");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    // Card should be gone
    expect(screen.queryByTestId("new-variant-card-2")).toBeNull();

    // Registry should be back to 1 entry (the existing variant)
    const latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries).toHaveLength(1);
    expect(latestEntries[0].isNew).toBeUndefined();
  });

  it("buildCreatePayload reflects edited fields on the new card", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    const ref = renderWithRef([], onDirtyChange, "verse");

    await act(async () => {
      ref.current?.stageNew();
    });

    // Edit the answer field on the new card (displayIndex=1)
    const answerInputs = screen.getAllByRole("textbox");
    // The new card renders Prompt (textarea), Answer (input), Distractors (input)
    // In order: 0=prompt textarea, 1=answer input, 2=distractors input
    // Find answer input by its position — it follows the Answer label
    const answerLabel = screen.getByText("Answer");
    const answerInput = answerLabel.nextElementSibling as HTMLInputElement;
    await act(async () => {
      fireEvent.change(answerInput, { target: { value: "the sky" } });
    });

    const latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries[0].isNew).toBe(true);
    const payload = latestEntries[0].buildCreatePayload!();
    expect(payload.answer).toBe("the sky");
    expect(payload.sectionType).toBe("verse");
  });

  it("two staged cards count separately; removing one leaves the other", async () => {
    const onDirtyChange = vi.fn<(entries: VariantDraftEntry[]) => void>();
    const ref = renderWithRef([baseVariant], onDirtyChange);

    await act(async () => {
      ref.current?.stageNew();
    });
    await act(async () => {
      ref.current?.stageNew();
    });

    // 1 existing + 2 new = 3 entries
    let latestEntries: VariantDraftEntry[] =
      onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries).toHaveLength(3);
    expect(latestEntries[1].isNew).toBe(true);
    expect(latestEntries[2].isNew).toBe(true);

    // Remove the first new card (displayIndex=2)
    const removeBtn = screen.getByTestId("new-variant-remove-2");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    latestEntries = onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1][0];
    expect(latestEntries).toHaveLength(2);
    expect(latestEntries[1].isNew).toBe(true);
  });
});
