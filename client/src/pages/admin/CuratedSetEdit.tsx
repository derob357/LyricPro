import { useParams } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { CuratedSetBuilder, type BuilderItem } from "./CuratedSetBuilder";

export default function CuratedSetEdit() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isLoading } = trpc.adminCuratedSets.get.useQuery({ id }, { enabled: !!id && user?.role === "admin" });
  const update = trpc.adminCuratedSets.update.useMutation();
  if (user?.role !== "admin") return <div className="p-8 text-center text-red-600 font-semibold">Access Denied: Admin only</div>;
  if (isLoading || !data) return <div className="p-8">Loading…</div>;
  const items: BuilderItem[] = data.items.map((it) => ({ songId: it.songId, variantIndex: it.variantIndex, title: it.title, artistName: it.artistName, variantPrompts: it.variantPrompts }));
  return (
    <CuratedSetBuilder
      initial={{ name: data.name, description: data.description ?? "", items }}
      saving={update.isPending}
      onSave={async (d) => { await update.mutateAsync({ id, patch: d }); }}
    />
  );
}
