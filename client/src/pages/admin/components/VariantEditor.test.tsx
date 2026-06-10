import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
import type { Variant } from "./VariantEditor";

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

  it("renders a variant card with the difficulty select defaulting to Inherit", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[baseVariant]}
        onChanged={() => {}}
      />,
    );
    const select = screen.getByTestId("variant-difficulty-0") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0].text).toMatch(/inherit/i);
  });

  it("when variant already has difficulty='high', the select shows 'high'", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[taggedVariant]}
        onChanged={() => {}}
      />,
    );
    const select = screen.getByTestId("variant-difficulty-0") as HTMLSelectElement;
    expect(select.value).toBe("high");
  });

  it("choosing 'high' and saving calls adminVariants.update with patch.difficulty === 'high'", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[baseVariant]}
        onChanged={() => {}}
      />,
    );
    const select = screen.getByTestId("variant-difficulty-0");
    fireEvent.change(select, { target: { value: "high" } });

    const saveBtn = screen.getByRole("button", { name: /save variant/i });
    fireEvent.click(saveBtn);

    expect(updateMutate).toHaveBeenCalledOnce();
    const call = updateMutate.mock.calls[0][0];
    expect(call.songId).toBe(SONG_ID);
    expect(call.variantIndex).toBe(0);
    expect(call.patch.difficulty).toBe("high");
  });

  it("clearing difficulty to Inherit sends patch.difficulty === null", () => {
    render(
      <VariantEditor
        songId={SONG_ID}
        variants={[taggedVariant]}
        onChanged={() => {}}
      />,
    );
    const select = screen.getByTestId("variant-difficulty-0");
    // clear from "high" back to Inherit
    fireEvent.change(select, { target: { value: "" } });

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
});
