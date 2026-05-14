import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search } from "lucide-react";

export default function SongsList() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<"active" | "disabled" | "pending" | undefined>(undefined);
  const [cursor, setCursor] = useState<number | undefined>(undefined);

  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Access Denied: Admin only</p>
      </div>
    );
  }

  const { data, isLoading } = trpc.adminSongs.list.useQuery({
    limit: 50,
    search: search || undefined,
    genre,
    status,
    cursor,
  });

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold mb-1">Songs</h1>
            <p className="text-muted-foreground text-sm">Catalogue management</p>
          </div>
          <Link href="/admin/songs/new">
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> Add song
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-center">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search title or artist..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(undefined);
              }}
              className="pl-9 w-64"
            />
          </div>
          <Select
            value={genre ?? "all"}
            onValueChange={(v) => {
              setGenre(v === "all" ? undefined : v);
              setCursor(undefined);
            }}
          >
            <SelectTrigger className="w-40"><SelectValue placeholder="Genre" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All genres</SelectItem>
              <SelectItem value="Rock">Rock</SelectItem>
              <SelectItem value="Pop">Pop</SelectItem>
              <SelectItem value="Hip Hop">Hip Hop</SelectItem>
              <SelectItem value="R&B">R&B</SelectItem>
              <SelectItem value="Country">Country</SelectItem>
              <SelectItem value="Gospel">Gospel</SelectItem>
              <SelectItem value="Soul">Soul</SelectItem>
              <SelectItem value="Jazz">Jazz</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status ?? "all"}
            onValueChange={(v) => {
              setStatus(v === "all" ? undefined : (v as "active" | "disabled" | "pending"));
              setCursor(undefined);
            }}
          >
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          <p className="text-center text-muted-foreground py-8">Loading...</p>
        )}

        {data && (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Artist</th>
                  <th className="px-4 py-3 font-medium">Genre</th>
                  <th className="px-4 py-3 font-medium">Year</th>
                  <th className="px-4 py-3 font-medium">Variants</th>
                  <th className="px-4 py-3 font-medium">Plays</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t hover:bg-muted/20 cursor-pointer"
                    onClick={() => {
                      window.location.href = `/admin/songs/${s.id}`;
                    }}
                  >
                    <td className="px-4 py-3 font-medium">{s.title}</td>
                    <td className="px-4 py-3">{s.artistName}</td>
                    <td className="px-4 py-3">{s.genre}</td>
                    <td className="px-4 py-3">{s.releaseYear}</td>
                    <td className="px-4 py-3">{s.variantCount}</td>
                    <td className="px-4 py-3">{s.displayCount}</td>
                    <td className="px-4 py-3"><StatusBadge song={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {data?.nextCursor !== null && data?.nextCursor !== undefined && (
          <div className="text-center mt-6">
            <Button variant="outline" onClick={() => setCursor(data.nextCursor!)}>Load more</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ song }: { song: { isActive: boolean; approvedForGame: boolean; approvalStatus: string } }) {
  if (!song.isActive) return <Badge variant="destructive">Disabled</Badge>;
  if (song.approvalStatus === "pending") return <Badge variant="secondary">Pending</Badge>;
  if (song.approvedForGame && song.isActive) return <Badge variant="default">Active</Badge>;
  return <Badge variant="outline">—</Badge>;
}
