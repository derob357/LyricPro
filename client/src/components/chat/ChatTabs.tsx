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
  const [tab, setTab] = useState<"global">("global");

  // Subscribe to the global realtime channel
  useChatChannel(tab === "global" ? GLOBAL_TOPIC : null);

  // Initial fetch (newest 50)
  const initial = trpc.chat.fetchInitial.useQuery(
    { scope: "global", roomId: GLOBAL_ROOM_ID, limit: 50 },
    { staleTime: 60_000 },
  );

  // Hydrate the store with the initial fetch results
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

  const messages = useChatMessages(GLOBAL_TOPIC);
  const ordered = useMemo(() => messages, [messages]);

  const postMutation = trpc.chat.postMessage.useMutation();
  const deleteMutation = trpc.chat.admin.deleteMessage.useMutation();
  const banMutation = trpc.chat.admin.banAuthor.useMutation();

  const handleSend = async (body: string) => {
    try {
      const result = await postMutation.mutateAsync({
        scope: "global",
        roomId: GLOBAL_ROOM_ID,
        body,
      });
      // Optimistic upsert; realtime echo will be deduped by id
      upsertMessage(GLOBAL_TOPIC, {
        id: Number(result.id),
        scope: "global",
        roomId: GLOBAL_ROOM_ID,
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
    <Tabs value={tab} onValueChange={(v) => setTab(v as "global")} className="flex flex-col h-full">
      <TabsList className="grid grid-cols-1 mx-3 mt-3">
        <TabsTrigger value="global">Global</TabsTrigger>
      </TabsList>
      <TabsContent value="global" className="flex flex-col flex-1 min-h-0 mt-2">
        <ChatMessageList
          messages={ordered}
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
    </Tabs>
  );
}
