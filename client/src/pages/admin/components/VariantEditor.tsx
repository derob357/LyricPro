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

function VariantCard({
  index,
  variant,
  onSave,
  onDelete,
}: {
  index: number;
  variant: Variant;
  onSave: (p: Partial<Variant>) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(variant);
  const dirty = JSON.stringify(draft) !== JSON.stringify(variant);
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
          value={draft.distractors.join(", ")}
          onChange={(e) =>
            setDraft({
              ...draft,
              distractors: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => onSave(draft)}
          className="gap-2"
        >
          <Save className="w-3 h-3" /> Save variant
        </Button>
      </div>
    </Card>
  );
}
