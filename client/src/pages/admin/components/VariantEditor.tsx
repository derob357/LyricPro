import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, X } from "lucide-react";

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

/** Payload shape for adminVariants.create (required fields). */
export interface VariantCreatePayload {
  prompt: string;
  answer: string;
  sectionType: string;
  distractors: string[];
  difficulty?: "low" | "medium" | "high" | null;
}

/** One entry per variant (existing or staged-new), published to parent via onDirtyChange. */
export interface VariantDraftEntry {
  dirty: boolean;
  /** True for staged-new cards that have not yet been persisted. */
  isNew?: boolean;
  /** Build the patch to pass to adminVariants.update for this (existing) variant. */
  buildPatch: () => VariantPatch;
  /** Present only on isNew entries — build the payload for adminVariants.create. */
  buildCreatePayload?: () => VariantCreatePayload;
}

/** Imperative handle exposed to parent via ref. */
export interface VariantEditorHandle {
  /** Stage a new blank variant card. */
  stageNew: () => void;
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

/** Draft state for a staged-new variant (not yet persisted). */
interface NewDraftState {
  /** Stable key (Date.now() at creation time) so React reconciles correctly. */
  key: number;
  prompt: string;
  answer: string;
  sectionType: string;
  distractorsText: string;
  difficultyValue: string;
}

function makeNewDraft(defaultSectionType: string): NewDraftState {
  return {
    key: Date.now(),
    prompt: "",
    answer: "",
    sectionType: defaultSectionType,
    distractorsText: "",
    difficultyValue: "",
  };
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

function buildCreatePayloadFromNewDraft(d: NewDraftState): VariantCreatePayload {
  const parsedDistractors = d.distractorsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const difficultyValue: "low" | "medium" | "high" | null =
    d.difficultyValue === ""
      ? null
      : (d.difficultyValue as "low" | "medium" | "high");
  return {
    prompt: d.prompt,
    answer: d.answer,
    sectionType: d.sectionType,
    distractors: parsedDistractors,
    difficulty: difficultyValue,
  };
}

// ─── VariantEditor ────────────────────────────────────────────────────────────

export const VariantEditor = forwardRef<
  VariantEditorHandle,
  {
    songId: number;
    variants: Variant[];
    onChanged: () => void;
    /**
     * Called whenever any variant's dirty/draft state changes.
     * Parent uses this to track page-level dirty state and to trigger saves.
     */
    onDirtyChange?: (entries: VariantDraftEntry[]) => void;
    /** Default sectionType for newly staged cards (should be the song's lyricSectionType). */
    defaultSectionType?: string;
    /**
     * Called whenever the number of staged-new (unpersisted) cards changes.
     * Parent uses this to know when to enable/disable the Add button.
     */
    onStagedCountChange?: (count: number) => void;
  }
>(function VariantEditor(
  {
    songId,
    variants,
    onChanged,
    onDirtyChange,
    defaultSectionType = "verse",
    onStagedCountChange,
  },
  ref,
) {
  const [drafts, setDrafts] = useState<DraftState[]>(() =>
    variants.map(toDraftState),
  );

  // Staged-new variant cards (not yet persisted).
  const [newDrafts, setNewDrafts] = useState<NewDraftState[]>([]);

  // Re-initialize existing drafts when variants change (e.g. after a save + refetch).
  // Also clear staged-new cards since they will now appear as persisted variants.
  useEffect(() => {
    setDrafts(variants.map(toDraftState));
    setNewDrafts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(variants)]);

  // Notify parent of staged count.
  useEffect(() => {
    onStagedCountChange?.(newDrafts.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDrafts.length]);

  // Publish dirty/patch/create entries to parent whenever any draft changes.
  useEffect(() => {
    if (!onDirtyChange) return;
    const existingEntries: VariantDraftEntry[] = drafts.map((d, i) => ({
      dirty: isDirty(d, variants[i]),
      buildPatch: () => buildPatchFromDraft(d),
    }));
    const newEntries: VariantDraftEntry[] = newDrafts.map((nd) => ({
      dirty: true,
      isNew: true,
      buildPatch: () => ({}), // unused for new entries; satisfies interface
      buildCreatePayload: () => buildCreatePayloadFromNewDraft(nd),
    }));
    onDirtyChange([...existingEntries, ...newEntries]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, newDrafts]);

  const deleteVariant = trpc.adminVariants.delete.useMutation({
    onSuccess: onChanged,
  });

  function updateDraft(index: number, patch: Partial<DraftState>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function updateNewDraft(key: number, patch: Partial<NewDraftState>) {
    setNewDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );
  }

  function unstageNew(key: number) {
    setNewDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  // Expose stageNew to parent via ref.
  useImperativeHandle(ref, () => ({
    stageNew() {
      setNewDrafts((prev) => [...prev, makeNewDraft(defaultSectionType)]);
    },
  }));

  return (
    <div className="space-y-3">
      {variants.map((v, i) => (
        <VariantCard
          key={i}
          index={i}
          variant={v}
          draft={drafts[i] ?? toDraftState(v)}
          onDraftChange={(patch) => updateDraft(i, patch)}
          onDelete={() => deleteVariant.mutate({ songId, variantIndex: i })}
        />
      ))}
      {newDrafts.map((nd, offset) => (
        <NewVariantCard
          key={nd.key}
          displayIndex={variants.length + offset + 1}
          draft={nd}
          onDraftChange={(patch) => updateNewDraft(nd.key, patch)}
          onUnstage={() => unstageNew(nd.key)}
        />
      ))}
    </div>
  );
});

// ─── VariantCard (existing persisted variant) ─────────────────────────────────

function VariantCard({
  index,
  variant,
  draft,
  onDraftChange,
  onDelete,
}: {
  index: number;
  variant: Variant;
  draft: DraftState;
  onDraftChange: (patch: Partial<DraftState>) => void;
  onDelete: () => void;
}) {
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
      <VariantFields
        draft={draft}
        index={index}
        onDraftChange={onDraftChange}
      />
      <div className="mt-2 text-sm text-muted-foreground">
        <span className="uppercase text-xs tracking-wide">Preview</span>
        <p className="text-foreground font-medium">
          &ldquo;{draft.prompt}<span className="text-accent">...</span>&rdquo; &rarr; <span className="text-primary">{draft.answer}</span>
        </p>
      </div>
    </Card>
  );
}

// ─── NewVariantCard (staged, not yet persisted) ───────────────────────────────

function NewVariantCard({
  displayIndex,
  draft,
  onDraftChange,
  onUnstage,
}: {
  displayIndex: number;
  draft: NewDraftState;
  onDraftChange: (patch: Partial<NewDraftState>) => void;
  onUnstage: () => void;
}) {
  return (
    <Card
      className="p-4 space-y-3 border-dashed border-primary/40"
      data-testid={`new-variant-card-${displayIndex}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium flex items-center gap-2">
          #{displayIndex} &middot;{" "}
          <span className="text-muted-foreground">{draft.sectionType}</span>
          <span
            className="text-xs text-primary/70 border border-primary/30 rounded px-1.5 py-0 leading-5"
            data-testid={`new-variant-badge-${displayIndex}`}
          >
            New — not saved yet
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onUnstage}
          title="Remove this staged variant"
          data-testid={`new-variant-remove-${displayIndex}`}
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </Button>
      </div>
      <VariantFields
        draft={draft}
        index={displayIndex - 1}
        onDraftChange={onDraftChange}
        testIdSuffix={`new-${displayIndex}`}
      />
      <div className="mt-2 text-sm text-muted-foreground">
        <span className="uppercase text-xs tracking-wide">Preview</span>
        <p className="text-foreground font-medium">
          &ldquo;{draft.prompt}<span className="text-accent">...</span>&rdquo; &rarr; <span className="text-primary">{draft.answer}</span>
        </p>
      </div>
    </Card>
  );
}

// ─── VariantFields — shared field group ───────────────────────────────────────

function VariantFields({
  draft,
  index,
  onDraftChange,
  testIdSuffix,
}: {
  draft: { prompt: string; answer: string; sectionType: string; distractorsText: string; difficultyValue: string };
  index: number;
  onDraftChange: (patch: { prompt?: string; answer?: string; sectionType?: string; distractorsText?: string; difficultyValue?: string }) => void;
  testIdSuffix?: string;
}) {
  const diffId = testIdSuffix ?? String(index);
  return (
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
        data-testid={`variant-difficulty-${diffId}`}
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
            data-testid={`variant-difficulty-${diffId}-${value || "inherit"}`}
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
  );
}
