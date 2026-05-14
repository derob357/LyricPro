import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ActionVerbChip } from "./ActionVerbChip";
import { Copy } from "lucide-react";

export function LogDrawer({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any | null;
}) {
  if (!row) return null;
  const payload = row.payload ?? {};
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ActionVerbChip action={row.action} /> {row.action}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs mb-1">Actor</div>
            <div className="font-mono">{row.actorEmail ?? "system"} (id {row.actorId ?? "—"})</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">When</div>
            <div className="font-mono">{new Date(row.occurredAt).toISOString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Source</div>
            <div className="font-mono">
              {row.ipTruncated ?? "—"} · {(row.userAgent ?? "").split(" ")[0] || "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Target</div>
            <div className="font-mono">
              {row.targetType}: {row.targetId}
              {row.targetVariantIndex !== null && row.targetVariantIndex !== undefined
                ? ` (#${row.targetVariantIndex})`
                : ""}
            </div>
          </div>
          {payload.before && payload.after && (
            <DiffSection before={payload.before} after={payload.after} />
          )}
          <details>
            <summary className="cursor-pointer text-muted-foreground text-xs">Raw payload</summary>
            <pre className="text-xs bg-muted/30 p-3 rounded mt-2 overflow-x-auto">
              {JSON.stringify(payload, null, 2)}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify(payload, null, 2))}
              className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-1"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
          </details>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DiffSection({ before, after }: { before: any; after: any }) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed = Array.from(keys).filter(
    (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])
  );
  if (changed.length === 0) return null;
  return (
    <div>
      <div className="text-muted-foreground text-xs mb-2">Changes</div>
      <div className="space-y-1">
        {changed.map((k) => (
          <div key={k} className="text-xs font-mono">
            <span className="text-muted-foreground">{k}:</span>{" "}
            <span className="text-red-600 line-through">{JSON.stringify(before?.[k]) ?? "—"}</span>
            {" → "}
            <span className="text-green-600">{JSON.stringify(after?.[k]) ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
