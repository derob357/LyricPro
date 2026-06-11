import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Save } from "lucide-react";

export interface Variant {
  prompt: string;
  answer: string;
  distractors: string[];
  sectionType: string;
  difficulty?: "low" | "medium" | "high";
}

export function VariantEditor({
  songId,
  variants,
  onChanged,
}: {
  songId: number;
  variants: Variant[];
  onChanged: () => void;
}) {
  const updateVariant = trpc.adminVariants.update.useMutation({
    onSuccess: onChanged,
  });
  const deleteVariant = trpc.adminVariants.delete.useMutation({
    onSuccess: onChanged,
  });
  return (
    <div className="space-y-3">
      {variants.map((v, i) => (
        <VariantCard
          key={i}
          index={i}
          variant={v}
          onSave={(patch) =>
            updateVariant.mutate({ songId, variantIndex: i, patch })
          }
          onDelete={() => deleteVariant.mutate({ songId, variantIndex: i })}
        />
      ))}
    </div>
  );
}

// Patch type matches the server variantPatchSchema:
// difficulty: null = clear to Inherit; undefined = no change; value = set.
// Omit difficulty from Partial<Variant> before re-adding so null is a valid value.
type VariantPatch = Omit<Partial<Variant>, "difficulty"> & {
  difficulty?: "low" | "medium" | "high" | null;
};

function VariantCard({
  index,
  variant,
  onSave,
  onDelete,
}: {
  index: number;
  variant: Variant;
  onSave: (p: VariantPatch) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(variant);
  // Distractors are edited as a raw comma-separated string and only parsed
  // into an array on save. Parsing on every keystroke (the old approach)
  // made it impossible to type a trailing comma/space to begin a new entry.
  const [distractorsText, setDistractorsText] = useState(
    variant.distractors.join(", "),
  );
  // difficultyValue: "" = Inherit (unset), or "low"/"medium"/"high"
  const [difficultyValue, setDifficultyValue] = useState<string>(
    variant.difficulty ?? "",
  );
  const parsedDistractors = distractorsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dirty =
    draft.prompt !== variant.prompt ||
    draft.answer !== variant.answer ||
    draft.sectionType !== variant.sectionType ||
    JSON.stringify(parsedDistractors) !== JSON.stringify(variant.distractors) ||
    difficultyValue !== (variant.difficulty ?? "");

  function handleSave() {
    // difficulty patch semantics:
    //   ""        → null  (clear the tag, back to Inherit / heuristic)
    //   "low" etc → value (set explicitly)
    const difficultyPatch: "low" | "medium" | "high" | null =
      difficultyValue === ""
        ? null
        : (difficultyValue as "low" | "medium" | "high");
    const patch: VariantPatch = {
      prompt: draft.prompt,
      answer: draft.answer,
      sectionType: draft.sectionType,
      distractors: parsedDistractors,
      difficulty: difficultyPatch,
    };
    onSave(patch);
  }

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
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          rows={2}
        />
        <label className="text-xs text-muted-foreground">Answer</label>
        <Input
          value={draft.answer}
          onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
        />
        <label className="text-xs text-muted-foreground">
          Distractors (comma separated)
        </label>
        <Input
          value={distractorsText}
          onChange={(e) => setDistractorsText(e.target.value)}
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
              onClick={() => setDifficultyValue(value)}
              className={`rounded-full px-2.5 py-0.5 text-xs border transition-colors ${
                difficultyValue === value
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
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty}
          onClick={handleSave}
          className="gap-2"
        >
          <Save className="w-3 h-3" /> Save variant
        </Button>
      </div>
    </Card>
  );
}
