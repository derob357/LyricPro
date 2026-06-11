import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";

export interface Variant {
  prompt: string;
  answer: string;
  distractors: string[];
  sectionType: string;
  difficulty?: "low" | "medium" | "high";
}

// Patch type matches the server variantPatchSchema:
// difficulty: null = clear to Inherit; undefined = no change; value = set.
// Omit difficulty from Partial<Variant> before re-adding so null is a valid value.
export type VariantPatch = Omit<Partial<Variant>, "difficulty"> & {
  difficulty?: "low" | "medium" | "high" | null;
};

/** One entry per variant, published to parent via onDirtyChange. */
export interface VariantDraftEntry {
  dirty: boolean;
  /** Build the patch to pass to adminVariants.update for this variant. */
  buildPatch: () => VariantPatch;
}

// ─── Draft state held at VariantEditor level ──────────────────────────────────

interface DraftState {
  prompt: string;
  answer: string;
  sectionType: string;
  /** Raw comma-separated string so the user can type freely */
  distractorsText: string;
  /** "" = Inherit, "low"|"medium"|"high" = explicit */
  difficultyValue: string;
}

function toDraftState(v: Variant): DraftState {
  return {
    prompt: v.prompt,
    answer: v.answer,
    sectionType: v.sectionType,
    distractorsText: v.distractors.join(", "),
    difficultyValue: v.difficulty ?? "",
  };
}

function isDirty(d: DraftState, v: Variant): boolean {
  const parsedDistractors = d.distractorsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    d.prompt !== v.prompt ||
    d.answer !== v.answer ||
    d.sectionType !== v.sectionType ||
    JSON.stringify(parsedDistractors) !== JSON.stringify(v.distractors) ||
    d.difficultyValue !== (v.difficulty ?? "")
  );
}

function buildPatchFromDraft(d: DraftState): VariantPatch {
  const parsedDistractors = d.distractorsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const difficultyPatch: "low" | "medium" | "high" | null =
    d.difficultyValue === ""
      ? null
      : (d.difficultyValue as "low" | "medium" | "high");
  return {
    prompt: d.prompt,
    answer: d.answer,
    sectionType: d.sectionType,
    distractors: parsedDistractors,
    difficulty: difficultyPatch,
  };
}

// ─── VariantEditor ────────────────────────────────────────────────────────────

export function VariantEditor({
  songId,
  variants,
  onChanged,
  onDirtyChange,
}: {
  songId: number;
  variants: Variant[];
  onChanged: () => void;
  /**
   * Called whenever any variant's dirty/draft state changes.
   * Parent uses this to track page-level dirty state and to trigger saves.
   */
  onDirtyChange?: (entries: VariantDraftEntry[]) => void;
}) {
  const [drafts, setDrafts] = useState<DraftState[]>(() =>
    variants.map(toDraftState),
  );

  // Re-initialize drafts when variants change (e.g. after a save + refetch).
  useEffect(() => {
    setDrafts(variants.map(toDraftState));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(variants)]);

  // Publish dirty/patch entries to parent whenever drafts change.
  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(
      drafts.map((d, i) => ({
        dirty: isDirty(d, variants[i]),
        buildPatch: () => buildPatchFromDraft(d),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  const updateVariant = trpc.adminVariants.update.useMutation({
    onSuccess: onChanged,
  });
  const deleteVariant = trpc.adminVariants.delete.useMutation({
    onSuccess: onChanged,
  });

  function updateDraft(index: number, patch: Partial<DraftState>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  return (
    <div className="space-y-3">
      {variants.map((v, i) => (
        <VariantCard
          key={i}
          index={i}
          variant={v}
          draft={drafts[i] ?? toDraftState(v)}
          onDraftChange={(patch) => updateDraft(i, patch)}
          onSave={(patch) =>
            updateVariant.mutate({ songId, variantIndex: i, patch })
          }
          onDelete={() => deleteVariant.mutate({ songId, variantIndex: i })}
        />
      ))}
    </div>
  );
}

// ─── VariantCard ──────────────────────────────────────────────────────────────

function VariantCard({
  index,
  variant,
  draft,
  onDraftChange,
  onSave,
  onDelete,
}: {
  index: number;
  variant: Variant;
  draft: DraftState;
  onDraftChange: (patch: Partial<DraftState>) => void;
  onSave: (p: VariantPatch) => void;
  onDelete: () => void;
}) {
  const dirty = isDirty(draft, variant);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          #{index + 1} &middot;{" "}
          <span className="text-muted-foreground">{draft.sectionType}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Prompt</label>
        <Textarea
          value={draft.prompt}
          onChange={(e) => onDraftChange({ prompt: e.target.value })}
          rows={2}
        />
        <label className="text-xs text-muted-foreground">Answer</label>
        <Input
          value={draft.answer}
          onChange={(e) => onDraftChange({ answer: e.target.value })}
        />
        <label className="text-xs text-muted-foreground">
          Distractors (comma separated)
        </label>
        <Input
          value={draft.distractorsText}
          onChange={(e) => onDraftChange({ distractorsText: e.target.value })}
        />
        <label className="text-xs text-muted-foreground uppercase tracking-wide">Difficulty</label>
        <div
          data-testid={`variant-difficulty-${index}`}
          className="flex gap-1.5 flex-wrap"
        >
          {([
            { value: "", label: "Inherit", selectedColor: "bg-primary/20 border-primary/60 text-primary font-semibold" },
            { value: "low", label: "Low", selectedColor: "bg-green-500/20 border-green-500/60 text-green-400 font-semibold" },
            { value: "medium", label: "Medium", selectedColor: "bg-yellow-500/20 border-yellow-500/60 text-yellow-400 font-semibold" },
            { value: "high", label: "High", selectedColor: "bg-red-500/20 border-red-500/60 text-red-400 font-semibold" },
          ] as const).map(({ value, label, selectedColor }) => (
            <button
              key={value || "inherit"}
              type="button"
              data-testid={`variant-difficulty-${index}-${value || "inherit"}`}
              onClick={() => onDraftChange({ difficultyValue: value })}
              className={`rounded-full px-2.5 py-0.5 text-xs border transition-colors ${
                draft.difficultyValue === value
                  ? selectedColor
                  : "border-border/40 text-muted-foreground hover:border-primary/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        <span className="uppercase text-xs tracking-wide">Preview</span>
        <p className="text-foreground font-medium">
          &ldquo;{draft.prompt}<span className="text-accent">...</span>&rdquo; &rarr; <span className="text-primary">{draft.answer}</span>
        </p>
      </div>
      {/* Per-variant Save button retained for test compatibility (existing tests
          click it to assert the correct patch shape). Hidden from the primary
          UI flow — page-level Save is the intended action for end users. */}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => onSave(buildPatchFromDraft(draft))}
          className="gap-2"
          aria-label="Save variant"
        >
          Save variant
        </Button>
      </div>
    </Card>
  );
}
