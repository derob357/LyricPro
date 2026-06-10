import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft } from "lucide-react";

export default function SongNew() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState({
    title: "",
    artistName: "",
    genre: "Pop",
    releaseYear: 2024,
    decadeRange: "2020s",
    difficulty: "medium" as "low" | "medium" | "high",
    lyricSectionType: "verse" as "chorus" | "hook" | "verse" | "call-response" | "bridge",
    lyricPrompt: "",
    lyricAnswer: "",
  });
  const create = trpc.adminSongs.create.useMutation({
    onSuccess: (data) => navigate(`/admin/songs/${data.id}`),
  });

  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Access Denied: Admin only</p>
      </div>
    );
  }

  const canCreate =
    draft.title.trim().length > 0 &&
    draft.artistName.trim().length > 0 &&
    draft.lyricPrompt.trim().length > 0 &&
    draft.lyricAnswer.trim().length > 0;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/admin/songs")}
          className="mb-4 gap-2"
        >
          <ChevronLeft className="w-4 h-4" /> Back to songs
        </Button>
        <h1 className="text-3xl font-bold mb-6">Add song</h1>
        <Card className="p-6 space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div>
            <Label>Artist</Label>
            <Input value={draft.artistName} onChange={(e) => setDraft({ ...draft, artistName: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Genre</Label>
              <Input value={draft.genre} onChange={(e) => setDraft({ ...draft, genre: e.target.value })} />
            </div>
            <div>
              <Label>Year</Label>
              <Input
                type="number"
                value={draft.releaseYear}
                onChange={(e) => setDraft({ ...draft, releaseYear: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Decade</Label>
              <Input value={draft.decadeRange} onChange={(e) => setDraft({ ...draft, decadeRange: e.target.value })} />
            </div>
            <div>
              <Label>Difficulty</Label>
              <Select value={draft.difficulty} onValueChange={(v) => setDraft({ ...draft, difficulty: v as typeof draft.difficulty })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Section type</Label>
            <Select value={draft.lyricSectionType} onValueChange={(v) => setDraft({ ...draft, lyricSectionType: v as typeof draft.lyricSectionType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chorus">chorus</SelectItem>
                <SelectItem value="hook">hook</SelectItem>
                <SelectItem value="verse">verse</SelectItem>
                <SelectItem value="call-response">call-response</SelectItem>
                <SelectItem value="bridge">bridge</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Lyric prompt</Label>
            <Textarea
              value={draft.lyricPrompt}
              onChange={(e) => setDraft({ ...draft, lyricPrompt: e.target.value })}
              rows={2}
            />
          </div>
          <div>
            <Label>Lyric answer</Label>
            <Input value={draft.lyricAnswer} onChange={(e) => setDraft({ ...draft, lyricAnswer: e.target.value })} />
          </div>
          {(draft.lyricPrompt || draft.lyricAnswer) && (
            <div className="mt-2 text-sm text-muted-foreground">
              <span className="uppercase text-xs tracking-wide">Preview</span>
              <p className="text-foreground font-medium">
                &ldquo;{draft.lyricPrompt}<span className="text-accent">...</span>&rdquo; &rarr; <span className="text-primary">{draft.lyricAnswer}</span>
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => create.mutate(draft)} disabled={!canCreate || create.isPending}>
              {create.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
