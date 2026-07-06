// client/src/pages/vendor/VendorDashboard.tsx
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { VendorRange } from "./lib";
import GrowthTab from "./tabs/GrowthTab";
import EngagementTab from "./tabs/EngagementTab";
import ContentTab from "./tabs/ContentTab";
import MonetizationTab from "./tabs/MonetizationTab";

const FAMILY_LABELS: Record<string, string> = {
  growth: "Growth",
  engagement: "Engagement",
  content: "Content",
  monetization: "Monetization",
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function VendorDashboard() {
  const { user, loading } = useAuth();
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(30));
  const [customTo, setCustomTo] = useState(isoDaysAgo(1));
  const [granularity, setGranularity] = useState<VendorRange["granularity"]>("day");

  const enabled = user?.role === "vendor";
  const me = trpc.vendor.me.useQuery(undefined, { enabled });

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (user?.role !== "vendor") {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Access Denied: Vendor only</p>
      </div>
    );
  }

  const range: VendorRange =
    preset === "custom"
      ? { from: customFrom, to: customTo, granularity }
      : { from: isoDaysAgo(Number(preset)), to: isoDaysAgo(1), granularity };

  const rangeError =
    preset === "custom" && customFrom > customTo
      ? "Start date must be before end date"
      : preset === "custom" && (new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86_400_000 > 400
        ? "Range cannot exceed 400 days"
        : null;

  const scopes = me.data?.scopes ?? [];
  const notes = me.data?.definitions.metrics ?? {};

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{me.data?.vendorName ?? "Vendor"} — KPI Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Data {me.data?.dateRange.min ?? "…"} to {me.data?.dateRange.max ?? "…"} (nightly rollup)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" ? (
            <>
              <Input type="date" className="w-40" max={isoDaysAgo(1)} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <Input type="date" className="w-40" max={isoDaysAgo(1)} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          ) : null}
          <Select value={granularity} onValueChange={(v) => setGranularity(v as VendorRange["granularity"])}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {rangeError ? (
        <p className="text-sm text-red-600">{rangeError}</p>
      ) : me.isLoading ? (
        <p className="text-muted-foreground text-center py-12">Loading…</p>
      ) : (
        <Tabs defaultValue={scopes[0] ?? "api"} className="w-full">
          <TabsList>
            {scopes.map((s) => (
              <TabsTrigger key={s} value={s}>{FAMILY_LABELS[s]}</TabsTrigger>
            ))}
            <TabsTrigger value="api">API Access</TabsTrigger>
          </TabsList>
          {scopes.includes("growth") && (
            <TabsContent value="growth"><GrowthTab range={range} notes={notes} /></TabsContent>
          )}
          {scopes.includes("engagement") && (
            <TabsContent value="engagement"><EngagementTab range={range} notes={notes} /></TabsContent>
          )}
          {scopes.includes("content") && (
            <TabsContent value="content"><ContentTab range={range} notes={notes} /></TabsContent>
          )}
          {scopes.includes("monetization") && (
            <TabsContent value="monetization"><MonetizationTab range={range} notes={notes} /></TabsContent>
          )}
          <TabsContent value="api"><p className="text-muted-foreground p-6">Coming soon</p></TabsContent>
        </Tabs>
      )}
      <p className="text-xs text-muted-foreground">
        {(me.data?.definitions.notes ?? []).map((n) => (<span key={n} className="block">{n}</span>))}
      </p>
    </div>
  );
}
