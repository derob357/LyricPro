import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Trash2, ChevronRight } from "lucide-react";

export default function GenresTab() {
  const { data: allGenres, refetch } = trpc.adminGenres.list.useQuery();
  const createMut = trpc.adminGenres.create.useMutation({ onSuccess: () => { refetch(); setAdding(null); } });
  const updateMut = trpc.adminGenres.update.useMutation({ onSuccess: () => refetch() });
  const deleteMut = trpc.adminGenres.delete.useMutation({ onSuccess: () => refetch() });
  const [adding, setAdding] = useState<number | null | "top">(null);

  if (!allGenres) return <p className="text-muted-foreground py-4">Loading...</p>;

  const topLevel = allGenres.filter(g => !g.parentId);
  const childrenOf = (parentId: number) => allGenres.filter(g => g.parentId === parentId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage genres and subgenres. Subgenres appear as "Genre - Subgenre" on song edit pages. Songs use the top-level genre for filtering; subgenre is additional metadata.
        </p>
        <Button size="sm" className="gap-2" onClick={() => setAdding("top")}>
          <Plus className="w-3.5 h-3.5" /> Add genre
        </Button>
      </div>

      {adding === "top" && (
        <NewGenreForm
          label="New top-level genre"
          onSave={(name, sortOrder) => createMut.mutate({ name, parentId: null, sortOrder })}
          onCancel={() => setAdding(null)}
        />
      )}

      {topLevel.map(genre => (
        <Card key={genre.id} className="p-4">
          <GenreRow
            genre={genre}
            onSave={(patch) => updateMut.mutate({ id: genre.id, ...patch })}
            onDelete={() => deleteMut.mutate({ id: genre.id })}
          />
          <div className="ml-6 mt-2 space-y-2">
            {childrenOf(genre.id).map(sub => (
              <div key={sub.id} className="flex items-center gap-2">
                <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <GenreRow
                  genre={sub}
                  onSave={(patch) => updateMut.mutate({ id: sub.id, ...patch })}
                  onDelete={() => deleteMut.mutate({ id: sub.id })}
                  compact
                />
              </div>
            ))}
            {adding === genre.id ? (
              <div className="ml-5">
                <NewGenreForm
                  label={`New subgenre under ${genre.name}`}
                  onSave={(name, sortOrder) => createMut.mutate({ name, parentId: genre.id, sortOrder })}
                  onCancel={() => setAdding(null)}
                />
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="ml-5 text-xs text-muted-foreground gap-1"
                onClick={() => setAdding(genre.id)}
              >
                <Plus className="w-3 h-3" /> Add subgenre
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function GenreRow({ genre, onSave, onDelete, compact }: {
  genre: { id: number; name: string; sortOrder: number; isActive: boolean };
  onSave: (p: { name?: string; sortOrder?: number; isActive?: boolean }) => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(genre.name);
  const [sortOrder, setSortOrder] = useState(genre.sortOrder);

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <Input value={name} onChange={e => setName(e.target.value)} className={compact ? "h-8 text-sm" : ""} />
        <Input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} className={`w-20 ${compact ? "h-8 text-sm" : ""}`} />
        <Button size="sm" className="gap-1" onClick={() => { onSave({ name, sortOrder }); setEditing(false); }}>
          <Save className="w-3 h-3" /> Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setName(genre.name); setSortOrder(genre.sortOrder); setEditing(false); }}>Cancel</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between flex-1">
      <div className="flex items-center gap-2">
        <span className={`font-medium ${compact ? "text-sm" : ""} ${!genre.isActive ? "text-muted-foreground line-through" : ""}`}>
          {genre.name}
        </span>
        <Badge variant="outline" className="text-xs">{genre.sortOrder}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={genre.isActive} onCheckedChange={(c) => onSave({ isActive: c })} />
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function NewGenreForm({ label, onSave, onCancel }: {
  label: string;
  onSave: (name: string, sortOrder: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(100);
  return (
    <Card className="p-3 border-primary/30 flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}:</span>
      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Genre name" className="h-8 text-sm" />
      <Input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} className="w-20 h-8 text-sm" />
      <Button size="sm" disabled={!name} onClick={() => onSave(name, sortOrder)}>Create</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </Card>
  );
}
