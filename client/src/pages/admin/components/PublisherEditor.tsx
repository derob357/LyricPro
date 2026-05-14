import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

export interface Publisher { name: string; share?: number; territory?: string }

export function PublisherEditor({
  value,
  onChange,
}: {
  value: Publisher[];
  onChange: (v: Publisher[]) => void;
}) {
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={p.name}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...p, name: e.target.value };
              onChange(next);
            }}
            placeholder="Name"
            className="flex-1"
          />
          <Input
            value={p.territory ?? ""}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...p, territory: e.target.value || undefined };
              onChange(next);
            }}
            placeholder="Territory (ISO)"
            className="w-32"
          />
          <Input
            type="number"
            value={p.share ?? ""}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...p, share: e.target.value ? Number(e.target.value) : undefined };
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
        <Plus className="w-4 h-4" /> Add publisher
      </Button>
    </div>
  );
}
