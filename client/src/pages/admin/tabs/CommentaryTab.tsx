import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Trash2 } from "lucide-react";

export default function CommentaryTab() {
  const { data: templates, refetch } = trpc.adminSuggestions.listTemplates.useQuery();
  const updateMut = trpc.adminSuggestions.updateTemplate.useMutation({ onSuccess: () => refetch() });
  const deleteMut = trpc.adminSuggestions.deleteTemplate.useMutation({ onSuccess: () => refetch() });
  const createMut = trpc.adminSuggestions.createTemplate.useMutation({ onSuccess: () => { refetch(); setAdding(false); } });
  const [adding, setAdding] = useState(false);

  // Group templates by triggerKey for easier viewing.
  const grouped = new Map<string, typeof templates>();
  templates?.forEach(t => {
    const arr = grouped.get(t.triggerKey) ?? [];
    arr.push(t);
    grouped.set(t.triggerKey, arr);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Post-round commentary templates. Multiple templates per trigger key — one is picked randomly. Slots: {"{genre}"}, {"{responseTime}"}, {"{streakCount}"}, {"{margin}"}, {"{correctCount}"}.
        </p>
        <Button size="sm" className="gap-2" onClick={() => setAdding(true)}>
          <Plus className="w-3.5 h-3.5" /> Add template
        </Button>
      </div>

      {adding && <NewTemplateForm onSave={(t) => createMut.mutate(t)} onCancel={() => setAdding(false)} />}

      {Array.from(grouped.entries()).map(([key, items]) => (
        <div key={key}>
          <Badge variant="outline" className="mb-2">{key}</Badge>
          <div className="space-y-2">
            {items!.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                onSave={(patch) => updateMut.mutate({ id: t.id, ...patch })}
                onDelete={() => deleteMut.mutate({ id: t.id })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateCard({ template, onSave, onDelete }: {
  template: { id: number; triggerKey: string; text: string; priority: number; isActive: boolean };
  onSave: (p: { text?: string; triggerKey?: string; priority?: number; isActive?: boolean }) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(template.text);
  const [priority, setPriority] = useState(template.priority);
  const dirty = text !== template.text || priority !== template.priority;

  return (
    <Card className="p-3 flex items-start gap-3">
      <div className="flex-1 space-y-2">
        <Textarea value={text} onChange={e => setText(e.target.value)} rows={1} className="text-sm" />
        <div className="flex gap-2 items-center">
          <Input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} className="w-20 h-8 text-xs" />
          <Button size="sm" disabled={!dirty} onClick={() => onSave({ text, priority })} className="h-7 gap-1 text-xs">
            <Save className="w-3 h-3" /> Save
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Switch
          checked={template.isActive}
          onCheckedChange={(c) => onSave({ isActive: c })}
        />
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </div>
    </Card>
  );
}

function NewTemplateForm({ onSave, onCancel }: {
  onSave: (t: { triggerKey: string; text: string; priority: number }) => void;
  onCancel: () => void;
}) {
  const [triggerKey, setTriggerKey] = useState("");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState(100);
  const valid = triggerKey.length > 0 && text.length > 0;

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="flex gap-3">
        <Input value={triggerKey} onChange={e => setTriggerKey(e.target.value)} placeholder="trigger_key (e.g. zero_correct)" className="w-64" />
        <Input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} className="w-24" placeholder="Priority" />
      </div>
      <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Commentary text with {slots}..." />
      <div className="flex gap-3">
        <Button size="sm" disabled={!valid} onClick={() => onSave({ triggerKey, text, priority })}>Create</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
