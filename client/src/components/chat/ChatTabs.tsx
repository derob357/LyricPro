import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useChatChannel } from "@/lib/chat/useChatChannel";
import { useChatMessages, upsertMessage } from "@/lib/chat/chatStore";
import { ChatMessageList } from "./ChatMessageList";
import { ChatComposer } from "./ChatComposer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

const GLOBAL_TOPIC = "chat:global";
const GLOBAL_ROOM_ID = 1;

export function ChatTabs() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"global" | "friends">("global");

  // Each authed user has their own inbox channel; null when unauthed.
  const friendsTopic = user ? `chat:user:${user.id}:feed` : null;
  const activeTopic = tab === "global" ? GLOBAL_TOPIC : friendsTopic;

  // Subscribe to whichever realtime channel matches the active tab.
  // useChatChannel cleans up on topic change, so switching tabs unsubscribes
  // the previous channel and resubscribes to the new one.
  useChatChannel(activeTopic);

  // --- Initial fetches ---------------------------------------------------
  // Global is always fetched (the tab is the default and cheap to keep warm).
  const initial = trpc.chat.fetchInitial.useQuery(
    { scope: "global", roomId: GLOBAL_ROOM_ID, limit: 50 },
    { staleTime: 60_000 },
  );

  useEffect(() => {
    if (!initial.data?.messages) return;
    for (const m of initial.data.messages) {
      upsertMessage(GLOBAL_TOPIC, {
        id: Number(m.id),
        scope: m.scope as "global" | "tournament" | "friends",
        roomId: m.roomId,
        authorId: m.authorId,
        body: m.body,
        postedWhileShadowBanned: m.postedWhileShadowBanned,
        flagStatus: m.flagStatus,
        editedAt: m.editedAt as unknown as string | null,
        deletedAt: m.deletedAt as unknown as string | null,
        deletedBy: m.deletedBy,
        deletedReason: m.deletedReason,
        createdAt: m.createdAt as unknown as string,
      });
    }
  }, [initial.data]);

  // Friends is gated on the tab being active + the viewer being signed in.
  const friendsInitial = trpc.chat.fetchInitial.useQuery(
    { scope: "friends", limit: 50 },
    { enabled: tab === "friends" && !!user, staleTime: 60_000 },
  );

  useEffect(() => {
    if (!friendsInitial.data?.messages || !friendsTopic) return;
    for (const m of friendsInitial.data.messages) {
      upsertMessage(friendsTopic, {
        id: Number(m.id),
        scope: m.scope as "global" | "tournament" | "friends",
        roomId: m.roomId,
        authorId: m.authorId,
        body: m.body,
        postedWhileShadowBanned: m.postedWhileShadowBanned,
        flagStatus: m.flagStatus,
        editedAt: m.editedAt as unknown as string | null,
        deletedAt: m.deletedAt as unknown as string | null,
        deletedBy: m.deletedBy,
        deletedReason: m.deletedReason,
        createdAt: m.createdAt as unknown as string,
      });
    }
  }, [friendsInitial.data, friendsTopic]);

  // --- Displayed messages -----------------------------------------------
  const globalMessages = useChatMessages(GLOBAL_TOPIC);
  // useChatMessages("") is benign — the chatStore returns [] for any unknown
  // topic — so the unauthed fallback to an empty string is safe.
  const friendsMessages = useChatMessages(friendsTopic ?? "");
  const orderedGlobal = useMemo(() => globalMessages, [globalMessages]);
  // The friends inbox channel may carry events outside scope='friends' in the
  // future (moderation pushes, etc.). Keep the display narrowed.
  const friendsForDisplay = useMemo(
    () => friendsMessages.filter((m) => m.scope === "friends"),
    [friendsMessages],
  );

  // Empty-state gating uses the viewer's favorites count.
  const myFavorites = trpc.favorites.list.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const friendsEmpty = (myFavorites.data?.length ?? 0) === 0;

  const postMutation = trpc.chat.postMessage.useMutation();
  const deleteMutation = trpc.chat.admin.deleteMessage.useMutation();
  const banMutation = trpc.chat.admin.banAuthor.useMutation();

  const handleSend = async (body: string) => {
    try {
      const result = await postMutation.mutateAsync(
        tab === "global"
          ? { scope: "global", roomId: GLOBAL_ROOM_ID, body }
          : { scope: "friends", body },
      );
      const targetTopic = tab === "global" ? GLOBAL_TOPIC : friendsTopic!;
      // Optimistic upsert; realtime echo will be deduped by id
      upsertMessage(targetTopic, {
        id: Number(result.id),
        scope: tab,
        roomId: tab === "global" ? GLOBAL_ROOM_ID : null,
        authorId: user!.id,
        body,
        postedWhileShadowBanned: Boolean(result.postedWhileShadowBanned),
        flagStatus: "clean",
        editedAt: null,
        deletedAt: null,
        deletedBy: null,
        deletedReason: null,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  const handleAdminDelete = async (messageId: number) => {
    const reason = prompt("Reason for deletion?");
    if (!reason) return;
    try {
      await deleteMutation.mutateAsync({ messageId, reason });
      toast.success("Message deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleAdminBan = async (authorId: number) => {
    const reason = prompt(`Reason for banning user #${authorId} globally?`);
    if (!reason) return;
    try {
      await banMutation.mutateAsync({ userId: authorId, scope: "global", reason });
      toast.success(`User #${authorId} banned`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ban failed");
    }
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as "global" | "friends")}
      className="flex flex-col h-full"
    >
      <TabsList className="grid grid-cols-2 mx-3 mt-3">
        <TabsTrigger value="global">Global</TabsTrigger>
        <TabsTrigger value="friends">Friends</TabsTrigger>
      </TabsList>
      <TabsContent value="global" className="flex flex-col flex-1 min-h-0 mt-2">
        <ChatMessageList
          messages={orderedGlobal}
          viewerId={user?.id ?? null}
          viewerRole={user?.role ?? null}
          onAdminDelete={handleAdminDelete}
          onAdminBan={handleAdminBan}
        />
        <ChatComposer
          onSend={handleSend}
          disabledReason={user ? null : "Sign in to chat"}
        />
      </TabsContent>
      <TabsContent value="friends" className="flex flex-col flex-1 min-h-0 mt-2">
        {friendsEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center px-6 gap-2">
            <p className="text-sm text-muted-foreground">
              Favorite players on the leaderboard to start chatting.
            </p>
            <a
              href="/leaderboards"
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              Browse leaderboard
            </a>
          </div>
        ) : (
          <>
            <ChatMessageList
              messages={friendsForDisplay}
              viewerId={user?.id ?? null}
              viewerRole={user?.role ?? null}
              onAdminDelete={handleAdminDelete}
              onAdminBan={handleAdminBan}
            />
            <ChatComposer
              onSend={handleSend}
              disabledReason={user ? null : "Sign in to chat"}
            />
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
