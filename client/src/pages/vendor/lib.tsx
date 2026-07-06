// client/src/pages/vendor/lib.tsx
// Shared primitives for the vendor dashboard tabs.
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export type Cell = { value: number | null; suppressed: boolean };
export type VendorRange = { from: string; to: string; granularity: "day" | "week" | "month" };

export function cellText(c: Cell | undefined, digits = 0): string {
  if (!c) return "—";
  if (c.suppressed) return "•••";
  if (c.value === null) return "—";
  return c.value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function chartVal(c: Cell | undefined): number | null {
  if (!c || c.suppressed || c.value === null) return null;
  return c.value;
}

export function downloadCsv(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-4">{title}</h3>
      {children}
      {note ? <p className="text-xs text-muted-foreground mt-3">{note}</p> : null}
    </Card>
  );
}

export function StatCard({ label, cell, digits = 0 }: { label: string; cell: Cell | undefined; digits?: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{cellText(cell, digits)}</p>
    </Card>
  );
}

export function ExportButton({
  family,
  range,
  dimension,
  limit,
}: {
  family: "growth" | "engagement" | "content" | "monetization";
  range: VendorRange;
  dimension?: "song" | "genre" | "decade";
  limit?: number;
}) {
  const exportMut = trpc.vendor.exportCsv.useMutation({
    onSuccess: (r) => downloadCsv(r.csv, r.filename),
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={exportMut.isPending}
      onClick={() => exportMut.mutate({ family, ...range, dimension, limit })}
    >
      <Download className="h-4 w-4 mr-2" />
      Export CSV
    </Button>
  );
}
