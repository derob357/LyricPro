import { useState } from "react";
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
import { ChevronLeft } from "lucide-react";
import { SongwriterEditor, type Songwriter } from "./components/SongwriterEditor";
import { PublisherEditor, type Publisher } from "./components/PublisherEditor";
import { VariantEditor, type Variant } from "./components/VariantEditor";

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
  const update = trpc.adminSongs.update.useMutation({
    onSuccess: () => refetch(),
  });
  const disable = trpc.adminSongs.disable.useMutation({
    onSuccess: () => refetch(),
  });
  const enable = trpc.adminSongs.enable.useMutation({
    onSuccess: () => refetch(),
  });
  const statusPending = disable.isPending || enable.isPending;

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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/admin/songs")}
          className="mb-4 gap-2"
        >
          <ChevronLeft className="w-4 h-4" /> Back to songs
        </Button>
        <h1 className="text-3xl font-bold mb-1">{song.title}</h1>
        <p className="text-muted-foreground mb-4">
          {song.artistName}
          {song.featuredArtist ? ` ft. ${song.featuredArtist}` : ""}
        </p>

        {/* Active/disabled toggle — fires enable/disable immediately
            (separate from the section Save buttons) so the audit log
            records song.enable / song.disable rather than song.update. */}
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

        <SectionIdentity song={song} onSave={(patch) => update.mutate({ id: songId, patch })} />
        <SectionLicensing song={song} onSave={(patch) => update.mutate({ id: songId, patch })} />
        <SectionVariants songId={songId} variants={(song.lyricVariants ?? []) as Variant[]} onChanged={refetch} />
        <SectionNotes song={song} onSave={(patch) => update.mutate({ id: songId, patch })} />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-lg">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionIdentity({ song, onSave }: { song: any; onSave: (patch: any) => void }) {
  const [draft, setDraft] = useState({
    title: song.title,
    artistName: song.artistName,
    featuredArtist: song.featuredArtist ?? "",
    genre: song.genre,
    releaseYear: song.releaseYear,
  });
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify({
      title: song.title,
      artistName: song.artistName,
      featuredArtist: song.featuredArtist ?? "",
      genre: song.genre,
      releaseYear: song.releaseYear,
    });
  return (
    <SectionCard
      title="Identity"
      action={
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() =>
            onSave({
              ...draft,
              featuredArtist: draft.featuredArtist || null,
            })
          }
        >
          Save
        </Button>
      }
    >
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionLicensing({ song, onSave }: { song: any; onSave: (patch: any) => void }) {
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
  return (
    <SectionCard
      title="Licensing & PRO metadata"
      action={
        <Button
          size="sm"
          onClick={() =>
            onSave({
              iswc: draft.iswc || null,
              isrc: draft.isrc || null,
              lyricSourceProvider: draft.lyricSourceProvider,
              providerTrackId: draft.providerTrackId || null,
              songwriters: draft.songwriters,
              publishers: draft.publishers,
              approvedForGame: draft.approvedForGame,
              inCuratedBank: draft.inCuratedBank,
            })
          }
        >
          Save
        </Button>
      }
    >
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

function SectionVariants({
  songId,
  variants,
  onChanged,
}: {
  songId: number;
  variants: Variant[];
  onChanged: () => void;
}) {
  return (
    <SectionCard title={`Lyric variants (${variants.length})`}>
      <VariantEditor songId={songId} variants={variants} onChanged={onChanged} />
    </SectionCard>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionNotes({ song, onSave }: { song: any; onSave: (patch: any) => void }) {
  const [draft, setDraft] = useState(song.curatorNotes ?? "");
  const dirty = (song.curatorNotes ?? "") !== draft;
  return (
    <SectionCard
      title="Curator notes"
      action={
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => onSave({ curatorNotes: draft || null })}
        >
          Save
        </Button>
      }
    >
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} />
    </SectionCard>
  );
}
