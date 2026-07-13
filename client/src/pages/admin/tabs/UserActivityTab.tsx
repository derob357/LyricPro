// client/src/pages/admin/tabs/UserActivityTab.tsx
// Dot plot: rows = individual users/guests, columns = days. Surfaces pacing,
// streaks, one-and-done drop-off, and weekday/weekend patterns that aggregate
// charts (DAU/MAU) hide. Faint dot = no activity; open dot = played a round;
// filled = completed a game; ring = first in-window activity day.
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SortKey = "first-seen" | "recent" | "active-days";
type TypeKey = "all" | "registered" | "guest";
type TierKey = "all" | "free" | "player" | "pro" | "elite";

const CELL = 16; // px, square cells

function Dot({ round, game, ring }: { round: boolean; game: boolean; ring: boolean }) {
  // Strongest signal wins: filled (game) > open (round) > faint (none).
  const core = game ? (
    <span className="block h-2.5 w-2.5 rounded-full bg-primary" />
  ) : round ? (
    <span className="block h-2.5 w-2.5 rounded-full border-2 border-primary" />
  ) : (
    <span className="block h-1 w-1 rounded-full bg-muted-foreground/25" />
  );
  return (
    <span className={`flex h-full w-full items-center justify-center ${ring ? "rounded-full ring-2 ring-amber-500" : ""}`}>
      {core}
    </span>
  );
}

export default function UserActivityTab() {
  const [days, setDays] = useState(30);
  const [customDays, setCustomDays] = useState("");
  const [type, setType] = useState<TypeKey>("all");
  const [tier, setTier] = useState<TierKey>("all");
  const [newOnly, setNewOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("first-seen");

  const q = trpc.adminAnalytics.userActivity.useQuery({ days, type, tier, newInWindowOnly: newOnly, sort });

  const applyCustom = () => {
    const n = Number(customDays);
    if (Number.isInteger(n) && n >= 1 && n <= 365) setDays(n);
  };

  const windowDays = q.data?.windowDays ?? [];
  const rows = q.data?.rows ?? [];

  // Month labels: show a label on the first column of each month in-window.
  const monthLabels = windowDays.map((d, i) => {
    const prev = windowDays[i - 1];
    const label = !prev || prev.slice(0, 7) !== d.slice(0, 7)
      ? new Date(`${d}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })
      : "";
    return label;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setCustomDays(""); }}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="60">60 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
            {![30, 60, 90].includes(days) ? <SelectItem value={String(days)}>{days} days</SelectItem> : null}
          </SelectContent>
        </Select>
        <input
          type="number" min={1} max={365} placeholder="custom"
          className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm"
          value={customDays}
          onChange={(e) => setCustomDays(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }}
          onBlur={applyCustom}
        />
        <Select value={type} onValueChange={(v) => setType(v as TypeKey)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            <SelectItem value="registered">Registered</SelectItem>
            <SelectItem value="guest">Guests</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={(v) => setTier(v as TierKey)}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="player">Player</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="elite">Elite</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={newOnly} onCheckedChange={(v) => setNewOnly(v === true)} />
          New in window
        </label>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first-seen">Sort: first seen</SelectItem>
            <SelectItem value="recent">Sort: most recent</SelectItem>
            <SelectItem value="active-days">Sort: most active</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-muted-foreground/25" /> no activity</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-primary" /> played a round</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> completed a game</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-primary ring-2 ring-amber-500" /> first day in window</span>
          <span>Look for: streaks, one-and-done rows, weekday vs weekend bands.</span>
        </div>

        {q.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : q.error ? (
          <p className="py-8 text-center text-sm text-red-600">{q.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity in this window with these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid w-max"
              style={{ gridTemplateColumns: `max-content repeat(${windowDays.length}, ${CELL}px)` }}
            >
              {/* month header row */}
              <div className="sticky left-0 z-10 bg-card" />
              {monthLabels.map((m, i) => (
                <div key={windowDays[i]} className="h-5 text-[10px] text-muted-foreground">{m}</div>
              ))}
              {/* one row per actor */}
              {rows.map((r) => (
                <div key={r.actor} className="contents">
                  <div
                    className="sticky left-0 z-10 flex items-center gap-1.5 bg-card pr-3 text-sm"
                    style={{ height: CELL + 2 }}
                    title={[
                      r.attrs.rankTier && `rank: ${r.attrs.rankTier}`,
                      r.attrs.favoriteGenre && `genre: ${r.attrs.favoriteGenre}`,
                      r.attrs.gamesPlayed != null && `games: ${r.attrs.gamesPlayed}`,
                      r.attrs.loginMethod && `login: ${r.attrs.loginMethod}`,
                      r.attrs.createdAt && `created: ${r.attrs.createdAt.slice(0, 10)}`,
                      r.type === "guest" && (r.attrs.hasEmail ? "has email" : "no email"),
                    ].filter(Boolean).join(" · ")}
                  >
                    <span className="max-w-40 truncate">{r.label}</span>
                    {r.type === "guest" ? (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">guest</span>
                    ) : r.tier && r.tier !== "free" ? (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{r.tier}</span>
                    ) : null}
                  </div>
                  {windowDays.map((d) => {
                    const round = r.roundDays.includes(d);
                    const game = r.gameDays.includes(d);
                    const ring = d === r.firstActivityDay;
                    const what = game ? "completed a game" : round ? "played a round" : "no activity";
                    return (
                      <div key={d} style={{ height: CELL + 2 }} title={`${d}: ${what}${ring ? " · first day" : ""}`}>
                        <Dot round={round} game={game} ring={ring} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {q.data?.truncated ? (
              <p className="mt-2 text-xs text-muted-foreground">Showing first 500 rows — narrow the filters to see the rest.</p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
