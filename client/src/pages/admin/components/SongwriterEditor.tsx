import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

export interface Songwriter { name: string; share?: number; ipiNumber?: string }

export function SongwriterEditor({
  value,
  onChange,
}: {
  value: Songwriter[];
  onChange: (v: Songwriter[]) => void;
}) {
  return (
    <div className="space-y-2">
      {value.map((sw, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={sw.name}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...sw, name: e.target.value };
              onChange(next);
            }}
            placeholder="Name"
            className="flex-1"
          />
          <Input
            value={sw.ipiNumber ?? ""}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...sw, ipiNumber: e.target.value || undefined };
              onChange(next);
            }}
            placeholder="IPI"
            className="w-32"
          />
          <Input
            type="number"
            value={sw.share ?? ""}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...sw, share: e.target.value ? Number(e.target.value) : undefined };
              onChange(next);
            }}
            placeholder="Share %"
            className="w-24"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { name: "" }])}
        className="gap-2"
      >
        <Plus className="w-4 h-4" /> Add songwriter
      </Button>
    </div>
  );
}
