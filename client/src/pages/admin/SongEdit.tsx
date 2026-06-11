import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Save } from "lucide-react";
import { SongwriterEditor, type Songwriter } from "./components/SongwriterEditor";
import { PublisherEditor, type Publisher } from "./components/PublisherEditor";
import { VariantEditor, type Variant, type VariantDraftEntry } from "./components/VariantEditor";
import { SongNavCluster } from "./components/SongNavCluster";

// ─── Registry types ────────────────────────────────────────────────────────────

/**
 * Each saveable section registers a handle so the page-level Save can
 * trigger all pending saves in one click.
 */
interface SectionHandle {
  /** True when the section has unsaved changes. */
  dirty: boolean;
  /**
   * Persist any pending changes.
   * Resolves when the mutation completes; rejects on error.
   */
  save: () => Promise<void>;
}

// ─── SongEdit page ─────────────────────────────────────────────────────────────

export default function SongEdit() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const songId = Number(params.id);

  const {
    data: song,
    refetch,
    isLoading,
  } = trpc.adminSongs.get.useQuery({ id: songId }, { enabled: !!songId });
  const update = trpc.adminSongs.update.useMutation();
  const disable = trpc.adminSongs.disable.useMutation({
    onSuccess: () => refetch(),
  });
  const enable = trpc.adminSongs.enable.useMutation({
    onSuccess: () => refetch(),
  });
  const updateVariant = trpc.adminVariants.update.useMutation();
  const statusPending = disable.isPending || enable.isPending;

  // ── Section registry ──────────────────────────────────────────────────────
  // Song-field sections register their dirty state + save callback here.
  const identityRef = useRef<SectionHandle | null>(null);
  const licensingRef = useRef<SectionHandle | null>(null);
  const notesRef = useRef<SectionHandle | null>(null);

  // Variant entries come in via VariantEditor's onDirtyChange callback.
  const [variantEntries, setVariantEntries] = useState<VariantDraftEntry[]>([]);

  // ── Page-level dirty ──────────────────────────────────────────────────────
  const [, forceRender] = useState(0);
  const notifyDirty = useCallback(() => forceRender((n) => n + 1), []);

  const sectionsDirty =
    (identityRef.current?.dirty ?? false) ||
    (licensingRef.current?.dirty ?? false) ||
    (notesRef.current?.dirty ?? false);
  const variantsDirty = variantEntries.some((e) => e.dirty);
  const anyDirty = sectionsDirty || variantsDirty;

  // ── Toast helpers (simple inline, no external dep) ─────────────────────
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Page-level Save ───────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);

  async function handlePageSave() {
    if (!anyDirty || isSaving) return;
    setIsSaving(true);
    try {
      // 1. Song-field sections (identity, licensing, notes) — run in parallel
      //    since they all write distinct top-level fields on the same row and
      //    adminSongs.update merges patches server-side.
      const sectionSaves: Promise<void>[] = [];
      if (identityRef.current?.dirty) sectionSaves.push(identityRef.current.save());
      if (licensingRef.current?.dirty) sectionSaves.push(licensingRef.current.save());
      if (notesRef.current?.dirty) sectionSaves.push(notesRef.current.save());
      if (sectionSaves.length) {
        await Promise.all(sectionSaves);
      }

      // 2. Variant saves MUST be sequential — each update re-reads the song
      //    row's lyricVariants jsonb and splices in the new value at the given
      //    index. Running them in parallel risks two writes racing to read a
      //    stale array and one clobbering the other's changes.
      const dirtyVariants = variantEntries
        .map((e, i) => ({ entry: e, index: i }))
        .filter(({ entry }) => entry.dirty);
      for (const { entry, index } of dirtyVariants) {
        const patch = entry.buildPatch();
        await new Promise<void>((resolve, reject) => {
          updateVariant.mutate(
            { songId, variantIndex: index, patch },
            { onSuccess: () => resolve(), onError: (err) => reject(err) },
          );
        });
      }

      await refetch();
      showToast("All changes saved", true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Save failed — please retry";
      showToast(msg, false);
      // Dirty flags are NOT reset on error so the user can retry.
    } finally {
      setIsSaving(false);
    }
  }

  // ── Unsaved-changes guard for nav ─────────────────────────────────────────
  function confirmLeave(): boolean {
    if (!anyDirty) return true;
    return window.confirm("You have unsaved changes — leave anyway?");
  }

  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Access Denied: Admin only</p>
      </div>
    );
  }
  if (isLoading || !song) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header row: back button | nav cluster | page-level Save */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirmLeave()) navigate("/admin/songs");
            }}
            className="gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> Back to songs
          </Button>
          <div className="flex items-center gap-2">
            <SongNavCluster currentId={songId} onBeforeNavigate={confirmLeave} />
            <Button
              size="sm"
              disabled={!anyDirty || isSaving}
              onClick={handlePageSave}
              className="gap-2"
              data-testid="page-save-btn"
            >
              <Save className="w-4 h-4" />
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Inline toast */}
        {toast && (
          <div
            data-testid="save-toast"
            className={`mb-4 px-4 py-2 rounded text-sm font-medium ${
              toast.ok
                ? "bg-green-500/20 text-green-400 border border-green-500/40"
                : "bg-red-500/20 text-red-400 border border-red-500/40"
            }`}
          >
            {toast.msg}
          </div>
        )}

        <h1 className="text-3xl font-bold mb-1">{song.title}</h1>
        <p className="text-muted-foreground mb-4">
          {song.artistName}
          {song.featuredArtist ? ` ft. ${song.featuredArtist}` : ""}
        </p>

        {/* Active/disabled toggle — fires enable/disable immediately
            (separate from the page Save) so the audit log records
            song.enable / song.disable rather than song.update. */}
        <div className="flex items-center gap-3 mb-6">
          <Switch
            checked={song.isActive}
            disabled={statusPending}
            onCheckedChange={(c) =>
              c
                ? enable.mutate({ id: songId })
                : disable.mutate({ id: songId })
            }
          />
          <Label>{song.isActive ? "Active" : "Disabled"}</Label>
          {!song.isActive && (
            <span className="text-xs text-muted-foreground">
              Hidden from gameplay
            </span>
          )}
        </div>

        <SectionIdentity
          song={song}
          onRegister={(handle) => {
            identityRef.current = handle;
            notifyDirty();
          }}
          onSave={(patch) =>
            update.mutateAsync({ id: songId, patch })
          }
        />
        <SectionLicensing
          song={song}
          onRegister={(handle) => {
            licensingRef.current = handle;
            notifyDirty();
          }}
          onSave={(patch) =>
            update.mutateAsync({ id: songId, patch })
          }
        />
        <SectionVariants
          songId={songId}
          variants={(song.lyricVariants ?? []) as Variant[]}
          onChanged={refetch}
          onDirtyChange={setVariantEntries}
        />
        <SectionNotes
          song={song}
          onRegister={(handle) => {
            notesRef.current = handle;
            notifyDirty();
          }}
          onSave={(patch) =>
            update.mutateAsync({ id: songId, patch })
          }
        />
      </div>
    </div>
  );
}

// ─── SectionCard ──────────────────────────────────────────────────────────────

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-lg">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

// ─── SectionIdentity ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionIdentity({
  song,
  onRegister,
  onSave,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  song: any;
  onRegister: (handle: SectionHandle) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (patch: any) => Promise<unknown>;
}) {
  const { data: allGenres } = trpc.adminGenres.list.useQuery();
  const [draft, setDraft] = useState({
    title: song.title,
    artistName: song.artistName,
    featuredArtist: song.featuredArtist ?? "",
    genre: song.genre,
    subgenre: song.subgenre ?? "",
    releaseYear: song.releaseYear,
  });

  const baseline = {
    title: song.title,
    artistName: song.artistName,
    featuredArtist: song.featuredArtist ?? "",
    genre: song.genre,
    subgenre: song.subgenre ?? "",
    releaseYear: song.releaseYear,
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  // Register with parent on every render so dirty reflects current state.
  onRegister({
    dirty,
    save: () =>
      onSave({
        ...draft,
        featuredArtist: draft.featuredArtist || null,
        subgenre: draft.subgenre || null,
      }).then(() => undefined),
  });

  const topGenres = allGenres?.filter((g) => !g.parentId && g.isActive) ?? [];
  const selectedParent = topGenres.find((g) => g.name === draft.genre);
  const subgenres = selectedParent
    ? (allGenres?.filter((g) => g.parentId === selectedParent.id && g.isActive) ?? [])
    : [];

  return (
    <SectionCard title="Identity">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Title</Label>
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div>
          <Label>Artist</Label>
          <Input value={draft.artistName} onChange={(e) => setDraft({ ...draft, artistName: e.target.value })} />
        </div>
        <div>
          <Label>Featured artist</Label>
          <Input value={draft.featuredArtist} onChange={(e) => setDraft({ ...draft, featuredArtist: e.target.value })} />
        </div>
        <div>
          <Label>Genre</Label>
          <Select value={draft.genre} onValueChange={(v) => setDraft({ ...draft, genre: v, subgenre: "" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {topGenres.map((g) => (
                <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Subgenre</Label>
          <Select
            value={draft.subgenre || "__none__"}
            onValueChange={(v) => setDraft({ ...draft, subgenre: v === "__none__" ? "" : v })}
          >
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {subgenres.map((g) => (
                <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Year</Label>
          <Input
            type="number"
            value={draft.releaseYear}
            onChange={(e) => setDraft({ ...draft, releaseYear: Number(e.target.value) })}
          />
        </div>
      </div>
    </SectionCard>
  );
}

// ─── SectionLicensing ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionLicensing({
  song,
  onRegister,
  onSave,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  song: any;
  onRegister: (handle: SectionHandle) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (patch: any) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState({
    iswc: song.iswc ?? "",
    isrc: song.isrc ?? "",
    lyricSourceProvider: song.lyricSourceProvider as "internal" | "lyricfind" | "musixmatch" | "direct_publisher",
    providerTrackId: song.providerTrackId ?? "",
    songwriters: (song.songwriters ?? []) as Songwriter[],
    publishers: (song.publishers ?? []) as Publisher[],
    approvedForGame: song.approvedForGame as boolean,
    inCuratedBank: song.inCuratedBank as boolean,
  });

  // Licensing has no simple baseline comparison (nested objects) — treat as
  // always potentially dirty after first user interaction. We do a deep compare.
  const baseline = {
    iswc: song.iswc ?? "",
    isrc: song.isrc ?? "",
    lyricSourceProvider: song.lyricSourceProvider,
    providerTrackId: song.providerTrackId ?? "",
    songwriters: song.songwriters ?? [],
    publishers: song.publishers ?? [],
    approvedForGame: song.approvedForGame,
    inCuratedBank: song.inCuratedBank,
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  onRegister({
    dirty,
    save: () =>
      onSave({
        iswc: draft.iswc || null,
        isrc: draft.isrc || null,
        lyricSourceProvider: draft.lyricSourceProvider,
        providerTrackId: draft.providerTrackId || null,
        songwriters: draft.songwriters,
        publishers: draft.publishers,
        approvedForGame: draft.approvedForGame,
        inCuratedBank: draft.inCuratedBank,
      }).then(() => undefined),
  });

  return (
    <SectionCard title="Licensing & PRO metadata">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <Label>ISWC</Label>
          <Input value={draft.iswc} onChange={(e) => setDraft({ ...draft, iswc: e.target.value })} placeholder="T-345.246.800-1" />
        </div>
        <div>
          <Label>ISRC (canonical recording)</Label>
          <Input value={draft.isrc} onChange={(e) => setDraft({ ...draft, isrc: e.target.value })} placeholder="GBN9Y6800001" />
        </div>
        <div>
          <Label>Lyric source</Label>
          <Select
            value={draft.lyricSourceProvider}
            onValueChange={(v) =>
              setDraft({ ...draft, lyricSourceProvider: v as typeof draft.lyricSourceProvider })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">internal</SelectItem>
              <SelectItem value="lyricfind">lyricfind</SelectItem>
              <SelectItem value="musixmatch">musixmatch</SelectItem>
              <SelectItem value="direct_publisher">direct_publisher</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Provider track ID</Label>
          <Input
            value={draft.providerTrackId}
            onChange={(e) => setDraft({ ...draft, providerTrackId: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={draft.approvedForGame}
            onCheckedChange={(c) => setDraft({ ...draft, approvedForGame: c })}
          />
          <Label>Approved for game</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={draft.inCuratedBank}
            onCheckedChange={(c) => setDraft({ ...draft, inCuratedBank: c })}
          />
          <Label>In curated bank</Label>
        </div>
      </div>
      <Label className="block mb-2">Songwriters</Label>
      <SongwriterEditor value={draft.songwriters} onChange={(v) => setDraft({ ...draft, songwriters: v })} />
      <Label className="block mt-4 mb-2">Publishers</Label>
      <PublisherEditor value={draft.publishers} onChange={(v) => setDraft({ ...draft, publishers: v })} />
    </SectionCard>
  );
}

// ─── SectionVariants ──────────────────────────────────────────────────────────

function SectionVariants({
  songId,
  variants,
  onChanged,
  onDirtyChange,
}: {
  songId: number;
  variants: Variant[];
  onChanged: () => void;
  onDirtyChange: (entries: VariantDraftEntry[]) => void;
}) {
  return (
    <SectionCard title={`Lyric variants (${variants.length})`}>
      <VariantEditor
        songId={songId}
        variants={variants}
        onChanged={onChanged}
        onDirtyChange={onDirtyChange}
      />
    </SectionCard>
  );
}

// ─── SectionNotes ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionNotes({
  song,
  onRegister,
  onSave,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  song: any;
  onRegister: (handle: SectionHandle) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (patch: any) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(song.curatorNotes ?? "");
  const dirty = (song.curatorNotes ?? "") !== draft;

  onRegister({
    dirty,
    save: () => onSave({ curatorNotes: draft || null }).then(() => undefined),
  });

  return (
    <SectionCard title="Curator notes">
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} />
    </SectionCard>
  );
}
