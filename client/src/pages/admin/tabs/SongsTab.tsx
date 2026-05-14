import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ListMusic, Plus } from "lucide-react";

export default function SongsTab() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/admin/songs">
        <Button variant="outline" className="gap-2">
          <ListMusic className="w-4 h-4" /> Open Songs admin
        </Button>
      </Link>
      <Link href="/admin/songs/new">
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Add song
        </Button>
      </Link>
    </div>
  );
}
