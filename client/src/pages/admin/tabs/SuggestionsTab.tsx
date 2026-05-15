import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Trash2 } from "lucide-react";

export default function SuggestionsTab() {
  const { data: rules, refetch } = trpc.adminSuggestions.listRules.useQuery();
  const updateMut = trpc.adminSuggestions.updateRule.useMutation({ onSuccess: () => refetch() });
  const deleteMut = trpc.adminSuggestions.deleteRule.useMutation({ onSuccess: () => refetch() });
  const createMut = trpc.adminSuggestions.createRule.useMutation({ onSuccess: () => { refetch(); setAdding(false); } });
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Edit the text, action, priority, or toggle rules on/off. Lower priority = shown first. Use {"{strongGenre}"}, {"{weakGenre}"}, {"{gnBalance}"} as template slots.
        </p>
        <Button size="sm" className="gap-2" onClick={() => setAdding(true)}>
          <Plus className="w-3.5 h-3.5" /> Add rule
        </Button>
      </div>

      {adding && <NewRuleForm onSave={(r) => createMut.mutate(r)} onCancel={() => setAdding(false)} />}

      {rules?.map(rule => (
        <RuleCard
          key={rule.id}
          rule={rule}
          onSave={(patch) => updateMut.mutate({ id: rule.id, ...patch })}
          onDelete={() => deleteMut.mutate({ id: rule.id })}
        />
      ))}
    </div>
  );
}

function RuleCard({ rule, onSave, onDelete }: {
  rule: { id: number; category: string; triggerKey: string; text: string; action: string; priority: number; isActive: boolean };
  onSave: (p: { text?: string; action?: string; priority?: number; isActive?: boolean }) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(rule.text);
  const [action, setAction] = useState(rule.action);
  const [priority, setPriority] = useState(rule.priority);
  const dirty = text !== rule.text || action !== rule.action || priority !== rule.priority;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={rule.category === "mode" ? "default" : "secondary"}>{rule.category}</Badge>
          <code className="text-xs text-muted-foreground">{rule.triggerKey}</code>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={rule.isActive}
            onCheckedChange={(c) => onSave({ isActive: c })}
          />
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
      <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} />
      <div className="flex gap-3">
        <Input value={action} onChange={e => setAction(e.target.value)} className="flex-1" placeholder="Action URL" />
        <Input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} className="w-24" placeholder="Priority" />
        <Button size="sm" disabled={!dirty} onClick={() => onSave({ text, action, priority })} className="gap-1">
          <Save className="w-3 h-3" /> Save
        </Button>
      </div>
    </Card>
  );
}

function NewRuleForm({ onSave, onCancel }: {
  onSave: (r: { category: "mode" | "upsell"; triggerKey: string; text: string; action: string; priority: number }) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<"mode" | "upsell">("mode");
  const [triggerKey, setTriggerKey] = useState("");
  const [text, setText] = useState("");
  const [action, setAction] = useState("/play");
  const [priority, setPriority] = useState(100);
  const valid = triggerKey.length > 0 && text.length > 0;

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="flex gap-3">
        <select value={category} onChange={e => setCategory(e.target.value as "mode" | "upsell")}
          className="bg-background border rounded px-2 py-1 text-sm">
          <option value="mode">mode</option>
          <option value="upsell">upsell</option>
        </select>
        <Input value={triggerKey} onChange={e => setTriggerKey(e.target.value)} placeholder="trigger-key" className="w-48" />
        <Input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} className="w-24" placeholder="Priority" />
      </div>
      <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Suggestion text..." />
      <div className="flex gap-3">
        <Input value={action} onChange={e => setAction(e.target.value)} placeholder="/play?..." className="flex-1" />
        <Button size="sm" disabled={!valid} onClick={() => onSave({ category, triggerKey, text, action, priority })}>Create</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
