import { useState } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  targetUserId: number;
  // Whether the viewer has this user favorited (initial state from a list query).
  initialFavorited: boolean;
  // Optional: tooltip / aria-label custom text.
  className?: string;
}

export function FavoriteButton({ targetUserId, initialFavorited, className }: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const utils = trpc.useUtils();
  const addMutation = trpc.favorites.add.useMutation();
  const removeMutation = trpc.favorites.remove.useMutation();
  const busy = addMutation.isPending || removeMutation.isPending;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    const nextFavorited = !favorited;
    setFavorited(nextFavorited); // optimistic
    try {
      if (nextFavorited) {
        await addMutation.mutateAsync({ userId: targetUserId });
      } else {
        await removeMutation.mutateAsync({ userId: targetUserId });
      }
      // Invalidate so list-based components refresh
      void utils.favorites.list.invalidate();
      void utils.chat.unreadCounts.invalidate();
    } catch (err) {
      setFavorited(!nextFavorited); // rollback
      toast.error(err instanceof Error ? err.message : "Couldn't update favorite");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={favorited ? "Unfavorite player" : "Favorite player"}
      aria-pressed={favorited}
      disabled={busy}
      className={`h-8 w-8 shrink-0 ${className ?? ""}`}
    >
      <Heart
        className={`h-4 w-4 transition-colors ${
          favorited ? "fill-rose-500 text-rose-500" : "text-muted-foreground"
        }`}
      />
    </Button>
  );
}
