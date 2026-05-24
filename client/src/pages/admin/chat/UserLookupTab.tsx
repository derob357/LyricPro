import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function UserLookupTab() {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const lookup = trpc.chat.admin.userLookup.useQuery(
    { query: submittedQuery },
    { enabled: submittedQuery.length >= 1 },
  );
  const addFor = trpc.favorites.admin.addFor.useMutation();
  const removeFor = trpc.favorites.admin.removeFor.useMutation();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  };

  const handleAddFor = async (ownerId: number) => {
    const favIdRaw = prompt(`Add favorite (user id) to user #${ownerId}'s list?`);
    if (!favIdRaw) return;
    const favoriteId = parseInt(favIdRaw, 10);
    if (Number.isNaN(favoriteId)) return;
    const reason = prompt("Reason?") ?? "admin override";
    try {
      await addFor.mutateAsync({ ownerId, favoriteId, reason });
      void utils.chat.admin.userLookup.invalidate();
      toast.success(`Added user #${favoriteId} to #${ownerId}'s favorites`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleRemoveFor = async (ownerId: number) => {
    const favIdRaw = prompt(`Remove favorite (user id) from user #${ownerId}'s list?`);
    if (!favIdRaw) return;
    const favoriteId = parseInt(favIdRaw, 10);
    if (Number.isNaN(favoriteId)) return;
    const reason = prompt("Reason?") ?? "admin override";
    try {
      await removeFor.mutateAsync({ ownerId, favoriteId, reason });
      void utils.chat.admin.userLookup.invalidate();
      toast.success(`Removed user #${favoriteId} from #${ownerId}'s favorites`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="grid gap-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="lookup-query" className="sr-only">Search</Label>
          <Input
            id="lookup-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email, first name, or last name..."
          />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {lookup.isLoading && submittedQuery && <p className="text-muted-foreground text-sm">Searching...</p>}
      {lookup.data && lookup.data.users.length === 0 && submittedQuery && (
        <p className="text-muted-foreground text-sm">No users match.</p>
      )}
      {(lookup.data?.users ?? []).map((u) => (
        <Card key={u.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{u.email ?? `user #${u.id}`}</span>
                <Badge variant="outline">id {u.id}</Badge>
                {u.role === "admin" && <Badge>admin</Badge>}
                {u.activeBanCount > 0 && (
                  <Badge variant="destructive">{u.activeBanCount} active ban{u.activeBanCount === 1 ? "" : "s"}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {u.firstName} {u.lastName} - openId: <span className="font-mono">{u.openId}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => handleAddFor(u.id)}>
                Add favorite for them
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleRemoveFor(u.id)}>
                Remove favorite for them
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
