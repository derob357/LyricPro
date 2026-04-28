import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const FALLBACK_SVG = "/avatars/default-mic.svg";

const SIZE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-20 h-20",
};

export type UserAvatarProps = {
  // For the signed-in user, omit `slug` — the component pulls the equipped
  // avatar via the avatars.list query (cached). For other users (e.g.
  // leaderboard rows), pass the slug from the row payload.
  slug?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function UserAvatar({ slug, size = "sm", className }: UserAvatarProps) {
  const list = trpc.avatars.list.useQuery(undefined, {
    enabled: slug == null,
    staleTime: 60_000,
  });

  let resolved = FALLBACK_SVG;
  if (slug) {
    resolved = `/avatars/${slug}.svg`;
  } else if (list.data) {
    const equippedId = list.data.equippedAvatarId;
    const found = list.data.catalog.find((c) => c.id === equippedId);
    if (found) resolved = found.imageUrl;
  }

  return (
    <img
      src={resolved}
      alt=""
      className={cn(
        "rounded-full bg-muted object-cover ring-1 ring-border/50",
        SIZE_CLASSES[size],
        className,
      )}
    />
  );
}
