import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronUp, ChevronDown, Trash2, Save } from "lucide-react";

export type BuilderItem = { songId: number; variantIndex: number | null; title: string; artistName: string; variantPrompts: string[] };

export function CuratedSetBuilder(props: {
  initial: { name: string; description: string; items: BuilderItem[] };
  onSave: (data: { name: string; description: string | null; items: { songId: number; variantIndex: number | null }[] }) => Promise<void>;
  saving: boolean;
}) {
  const [, navigate] = useLocation();
  const [name, setName] = useState(props.initial.name);
  const [description, setDescription] = useState(props.initial.description);
  const [items, setItems] = useState<BuilderItem[]>(props.initial.items);
  const [artist, setArtist] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const show = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const byArtist = trpc.adminCuratedSets.songsByArtist.useQuery({ artist }, { enabled: artist.trim().length > 1 });
  const search = trpc.adminSongs.list.useQuery({ search: songSearch, limit: 20 }, { enabled: songSearch.trim().length > 1 });

  const has = (id: number) => items.some((i) => i.songId === id);
  const add = (s: { id: number; title: string; artistName: string; variantPrompts?: string[] }) => {
    if (has(s.id)) return;
    setItems((xs) => [...xs, { songId: s.id, variantIndex: null, title: s.title, artistName: s.artistName, variantPrompts: s.variantPrompts ?? [] }]);
  };
  const move = (i: number, d: -1 | 1) => setItems((xs) => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const remove = (i: number) => setItems((xs) => xs.filter((_, k) => k !== i));
  const setVariant = (i: number, v: number | null) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, variantIndex: v } : x)));

  async function save() {
    if (!name.trim()) return show("Name is required", false);
    if (items.length === 0) return show("Add at least one song", false);
    try {
      await props.onSave({ name: name.trim(), description: description.trim() || null, items: items.map(({ songId, variantIndex }) => ({ songId, variantIndex })) });
      show("Saved", true);
    } catch (e) { show(e instanceof Error ? e.message : "Save failed", false); }
  }

  return (
    <div className="container py-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/curated-sets")} className="gap-2"><ChevronLeft className="w-4 h-4" /> Back</Button>
        <Button size="sm" onClick={save} disabled={props.saving} className="gap-2"><Save className="w-4 h-4" /> {props.saving ? "Saving…" : "Save"}</Button>
      </div>
      {toast && <div className={`px-4 py-2 rounded text-sm ${toast.ok ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{toast.msg}</div>}

      <Card className="p-4 space-y-3">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anita Baker Night" /></div>
        <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </Card>

      <Card className="p-4 space-y-3">
        <Label>Add by artist</Label>
        <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Type an artist…" />
        <div className="flex flex-wrap gap-2">
          {byArtist.data?.filter((s) => !has(s.id)).map((s) => (
            <Button key={s.id} size="sm" variant="outline" onClick={() => add(s)}>+ {s.title}</Button>
          ))}
        </div>
        <Label className="pt-2">Search & add</Label>
        <Input value={songSearch} onChange={(e) => setSongSearch(e.target.value)} placeholder="Search any song…" />
        <div className="flex flex-wrap gap-2">
          {search.data?.rows.filter((s) => !has(s.id)).map((s) => (
            <Button key={s.id} size="sm" variant="outline" onClick={() => add({ id: s.id, title: s.title, artistName: s.artistName })}>+ {s.title} — {s.artistName}</Button>
          ))}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Song</th><th className="px-3 py-2">Lyric</th><th className="px-3 py-2 text-right">Order</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.songId} className="border-t">
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2">{it.title} <span className="text-muted-foreground">— {it.artistName}</span></td>
                <td className="px-3 py-2">
                  <Select value={it.variantIndex === null ? "default" : String(it.variantIndex)} onValueChange={(v) => setVariant(i, v === "default" ? null : Number(v))}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default lyric</SelectItem>
                      {it.variantPrompts.map((p, idx) => <SelectItem key={idx} value={String(idx)}>{p.slice(0, 50)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button size="icon" variant="ghost" onClick={() => move(i, -1)}><ChevronUp className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => move(i, 1)}><ChevronDown className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No songs yet — add some above.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
