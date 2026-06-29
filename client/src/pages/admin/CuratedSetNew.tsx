import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { CuratedSetBuilder } from "./CuratedSetBuilder";

export default function CuratedSetNew() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const create = trpc.adminCuratedSets.create.useMutation();
  if (user?.role !== "admin") return <div className="p-8 text-center text-red-600 font-semibold">Access Denied: Admin only</div>;
  return (
    <CuratedSetBuilder
      initial={{ name: "", description: "", items: [] }}
      saving={create.isPending}
      onSave={async (data) => {
        const created = await create.mutateAsync({
          name: data.name,
          description: data.description ?? undefined,
          items: data.items,
        });
        navigate(`/admin/curated-sets/${created.id}`);
      }}
    />
  );
}
