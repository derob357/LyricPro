import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

type BannerRow = {
  id: number;
  title: string;
  subtitle: string | null;
  ctaText: string;
  ctaAction: string;
  partnerName: string | null;
  badgeText: string | null;
  badgeColor: string | null;
  imageEmoji: string | null;
  audience: string;
  targetJson: Record<string, unknown> | null;
  priority: number;
  isActive: boolean;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  impressions: number;
  clicks: number;
  ctr: string;
};

export default function BannersTab() {
  const { data: banners, refetch } = trpc.banners.list.useQuery();
  const createMut = trpc.banners.create.useMutation({ onSuccess: () => { refetch(); setAdding(false); } });
  const updateMut = trpc.banners.update.useMutation({ onSuccess: () => refetch() });
  const deleteMut = trpc.banners.delete.useMutation({ onSuccess: () => refetch() });
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage promotional banners. Audiences: all, visitor, authenticated, targeted. Lower priority = shown first.
        </p>
        <Button size="sm" className="gap-2" onClick={() => setAdding(true)}>
          <Plus className="w-3.5 h-3.5" /> Add banner
        </Button>
      </div>

      {adding && (
        <NewBannerForm
          onSave={(b) => createMut.mutate(b)}
          onCancel={() => setAdding(false)}
        />
      )}

      {banners?.map(banner => (
        <BannerCard
          key={banner.id}
          banner={banner as BannerRow}
          onSave={(patch) => updateMut.mutate({ id: banner.id, ...patch })}
          onDelete={() => deleteMut.mutate({ id: banner.id })}
        />
      ))}
    </div>
  );
}

function BannerCard({ banner, onSave, onDelete }: {
  banner: BannerRow;
  onSave: (p: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(banner.title);
  const [subtitle, setSubtitle] = useState(banner.subtitle ?? "");
  const [ctaText, setCtaText] = useState(banner.ctaText);
  const [ctaAction, setCtaAction] = useState(banner.ctaAction);
  const [partnerName, setPartnerName] = useState(banner.partnerName ?? "");
  const [badgeText, setBadgeText] = useState(banner.badgeText ?? "");
  const [badgeColor, setBadgeColor] = useState(banner.badgeColor ?? "#EF4444");
  const [imageEmoji, setImageEmoji] = useState(banner.imageEmoji ?? "");
  const [audience, setAudience] = useState(banner.audience);
  const [priority, setPriority] = useState(banner.priority);
  const [startsAt, setStartsAt] = useState(banner.startsAt ? new Date(banner.startsAt).toISOString().slice(0, 16) : "");
  const [endsAt, setEndsAt] = useState(banner.endsAt ? new Date(banner.endsAt).toISOString().slice(0, 16) : "");

  const dirty =
    title !== banner.title ||
    subtitle !== (banner.subtitle ?? "") ||
    ctaText !== banner.ctaText ||
    ctaAction !== banner.ctaAction ||
    partnerName !== (banner.partnerName ?? "") ||
    badgeText !== (banner.badgeText ?? "") ||
    badgeColor !== (banner.badgeColor ?? "#EF4444") ||
    imageEmoji !== (banner.imageEmoji ?? "") ||
    audience !== banner.audience ||
    priority !== banner.priority ||
    startsAt !== (banner.startsAt ? new Date(banner.startsAt).toISOString().slice(0, 16) : "") ||
    endsAt !== (banner.endsAt ? new Date(banner.endsAt).toISOString().slice(0, 16) : "");

  const handleSave = () => {
    onSave({
      title,
      subtitle: subtitle || null,
      ctaText,
      ctaAction,
      partnerName: partnerName || null,
      badgeText: badgeText || null,
      badgeColor,
      imageEmoji: imageEmoji || null,
      audience,
      priority,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
    });
  };

  return (
    <Card className="p-4 space-y-3">
      {/* Summary row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          {banner.imageEmoji && <span className="text-lg">{banner.imageEmoji}</span>}
          <span className="font-medium truncate">{banner.title}</span>
          {banner.partnerName && (
            <span className="text-xs text-muted-foreground">by {banner.partnerName}</span>
          )}
          {banner.badgeText && (
            <Badge style={{ backgroundColor: banner.badgeColor ?? "#EF4444", color: "#fff" }} className="text-[10px] px-1.5 py-0">
              {banner.badgeText}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">{banner.audience}</Badge>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-3">
          <span title="Impressions">{banner.impressions} imp</span>
          <span title="Clicks">{banner.clicks} clk</span>
          <span title="Click-through rate">{banner.ctr}% CTR</span>
          <Switch
            checked={banner.isActive}
            onCheckedChange={(c) => onSave({ isActive: c })}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Expanded edit form */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t">
          <div className="grid grid-cols-2 gap-3">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" />
            <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Subtitle" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="CTA Text" />
            <Input value={ctaAction} onChange={e => setCtaAction(e.target.value)} placeholder="CTA Action URL" className="col-span-2" />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Input value={partnerName} onChange={e => setPartnerName(e.target.value)} placeholder="Partner Name" />
            <Input value={badgeText} onChange={e => setBadgeText(e.target.value)} placeholder="Badge Text" />
            <Input type="color" value={badgeColor} onChange={e => setBadgeColor(e.target.value)} className="w-full" title="Badge Color" />
            <Input value={imageEmoji} onChange={e => setImageEmoji(e.target.value)} placeholder="Emoji (e.g. 🎵)" />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <select
              value={audience}
              onChange={e => setAudience(e.target.value)}
              className="bg-background border rounded px-2 py-1 text-sm"
            >
              <option value="all">all</option>
              <option value="visitor">visitor</option>
              <option value="authenticated">authenticated</option>
              <option value="targeted">targeted</option>
            </select>
            <Input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} placeholder="Priority" />
            <Input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} title="Starts At" />
            <Input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} title="Ends At" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={!dirty} onClick={handleSave} className="gap-1">
              <Save className="w-3 h-3" /> Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function NewBannerForm({ onSave, onCancel }: {
  onSave: (b: {
    title: string;
    subtitle: string | null;
    ctaText: string;
    ctaAction: string;
    partnerName: string | null;
    badgeText: string | null;
    badgeColor: string;
    imageEmoji: string | null;
    audience: string;
    priority: number;
    startsAt: string | null;
    endsAt: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [ctaText, setCtaText] = useState("Learn More");
  const [ctaAction, setCtaAction] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [badgeText, setBadgeText] = useState("Featured");
  const [badgeColor, setBadgeColor] = useState("#EF4444");
  const [imageEmoji, setImageEmoji] = useState("");
  const [audience, setAudience] = useState("all");
  const [priority, setPriority] = useState(100);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const valid = title.length > 0 && ctaAction.length > 0;

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="grid grid-cols-2 gap-3">
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title *" />
        <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Subtitle" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="CTA Text" />
        <Input value={ctaAction} onChange={e => setCtaAction(e.target.value)} placeholder="CTA Action URL *" className="col-span-2" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Input value={partnerName} onChange={e => setPartnerName(e.target.value)} placeholder="Partner Name" />
        <Input value={badgeText} onChange={e => setBadgeText(e.target.value)} placeholder="Badge Text" />
        <Input type="color" value={badgeColor} onChange={e => setBadgeColor(e.target.value)} className="w-full" title="Badge Color" />
        <Input value={imageEmoji} onChange={e => setImageEmoji(e.target.value)} placeholder="Emoji (e.g. 🎵)" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <select
          value={audience}
          onChange={e => setAudience(e.target.value)}
          className="bg-background border rounded px-2 py-1 text-sm"
        >
          <option value="all">all</option>
          <option value="visitor">visitor</option>
          <option value="authenticated">authenticated</option>
          <option value="targeted">targeted</option>
        </select>
        <Input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} placeholder="Priority" />
        <Input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} title="Starts At" />
        <Input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} title="Ends At" />
      </div>
      <div className="flex gap-3">
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => onSave({
            title,
            subtitle: subtitle || null,
            ctaText,
            ctaAction,
            partnerName: partnerName || null,
            badgeText: badgeText || null,
            badgeColor,
            imageEmoji: imageEmoji || null,
            audience,
            priority,
            startsAt: startsAt || null,
            endsAt: endsAt || null,
          })}
        >
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
