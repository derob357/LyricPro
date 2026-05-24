import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function TournamentNew() {
  const [, navigate] = useLocation();
  const create = trpc.tournaments.admin.create.useMutation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entryCostGn, setEntryCostGn] = useState<number>(0);
  const [capacity, setCapacity] = useState<string>("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const result = await create.mutateAsync({
        name,
        description: description || undefined,
        entryCostGn,
        capacity: capacity ? parseInt(capacity, 10) : undefined,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      toast.success("Tournament created (draft).");
      navigate(`/admin/tournaments/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    }
  };

  return (
    <div className="container max-w-xl py-8">
      <h1 className="text-2xl font-bold mb-4">New Tournament</h1>
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="entryCostGn">Entry cost (GN)</Label>
              <Input
                id="entryCostGn"
                type="number"
                min={0}
                value={entryCostGn}
                onChange={(e) => setEntryCostGn(parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div>
              <Label htmlFor="capacity">Capacity (optional)</Label>
              <Input
                id="capacity"
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="startsAt">Starts at</Label>
              <Input
                id="startsAt"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="endsAt">Ends at</Label>
              <Input
                id="endsAt"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating..." : "Create (draft)"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
