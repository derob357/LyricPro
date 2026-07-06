import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../../server/app-router";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  Copy,
  KeyRound,
  X,
} from "lucide-react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Vendor = RouterOutputs["adminVendors"]["list"][number];
type ScopeKey = "scopeGrowth" | "scopeEngagement" | "scopeContent" | "scopeMonetization";

const SCOPES: { key: ScopeKey; label: string }[] = [
  { key: "scopeGrowth", label: "Growth" },
  { key: "scopeEngagement", label: "Engagement" },
  { key: "scopeContent", label: "Content" },
  { key: "scopeMonetization", label: "Monetization" },
];

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export default function VendorsTab() {
  const { data: vendors, refetch } = trpc.adminVendors.list.useQuery();
  const [addingVendor, setAddingVendor] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [freshKey, setFreshKey] = useState<{ plaintext: string; prefix: string } | null>(null);

  const createMut = trpc.adminVendors.create.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Saved");
      setAddingVendor(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.adminVendors.update.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const linkMemberMut = trpc.adminVendors.linkMember.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const unlinkMemberMut = trpc.adminVendors.unlinkMember.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const issueKeyMut = trpc.adminVendors.issueKey.useMutation({
    onSuccess: (data) => {
      refetch();
      toast.success("Saved");
      setFreshKey({ plaintext: data.plaintext, prefix: data.prefix });
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeKeyMut = trpc.adminVendors.revokeKey.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!vendors) return <p className="text-muted-foreground py-4">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage vendor accounts, member access, API keys, and catalog scope for the Vendor KPI API.
        </p>
        <Button size="sm" className="gap-2" onClick={() => setAddingVendor(true)}>
          <Plus className="w-3.5 h-3.5" /> New vendor
        </Button>
      </div>

      {addingVendor && (
        <NewVendorForm
          onSave={(name, contactEmail) => createMut.mutate({ name, contactEmail: contactEmail || undefined })}
          onCancel={() => setAddingVendor(false)}
        />
      )}

      {vendors.length === 0 && !addingVendor && (
        <p className="text-sm text-muted-foreground py-8 text-center">No vendors yet.</p>
      )}

      {vendors.map((vendor: Vendor) => (
        <Card key={vendor.id} className="p-4">
          <VendorRow
            vendor={vendor}
            expanded={expandedId === vendor.id}
            onToggle={() => setExpandedId(expandedId === vendor.id ? null : vendor.id)}
            onScopeChange={(patch) => updateMut.mutate({ id: vendor.id, ...patch })}
            onStatusToggle={() =>
              updateMut.mutate({ id: vendor.id, status: vendor.status === "active" ? "suspended" : "active" })
            }
          />
          {expandedId === vendor.id && (
            <VendorDetail
              vendor={vendor}
              onLinkMember={(email, onDone) => linkMemberMut.mutate({ vendorId: vendor.id, email }, { onSuccess: onDone })}
              onUnlinkMember={(userId) => unlinkMemberMut.mutate({ vendorId: vendor.id, userId })}
              onIssueKey={(label, onDone) => issueKeyMut.mutate({ vendorId: vendor.id, label }, { onSuccess: onDone })}
              onRevokeKey={(keyId) => {
                if (window.confirm("Revoke this key? This cannot be undone.")) {
                  revokeKeyMut.mutate({ keyId });
                }
              }}
              onCatalogFilterSave={(catalogFilter) => updateMut.mutate({ id: vendor.id, catalogFilter })}
              onCatalogFilterClear={() => updateMut.mutate({ id: vendor.id, catalogFilter: null })}
            />
          )}
        </Card>
      ))}

      {freshKey && <FreshKeyModal freshKey={freshKey} onDismiss={() => setFreshKey(null)} />}
    </div>
  );
}

function NewVendorForm({
  onSave,
  onCancel,
}: {
  onSave: (name: string, contactEmail: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  return (
    <Card className="p-3 border-primary/30 flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0">New vendor:</span>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" className="h-8 text-sm" />
      <Input
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
        placeholder="Contact email (optional)"
        className="h-8 text-sm"
      />
      <Button size="sm" disabled={!name.trim()} onClick={() => onSave(name.trim(), contactEmail.trim())}>
        Create
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </Card>
  );
}

function VendorRow({
  vendor,
  expanded,
  onToggle,
  onScopeChange,
  onStatusToggle,
}: {
  vendor: Vendor;
  expanded: boolean;
  onToggle: () => void;
  onScopeChange: (patch: Partial<Record<(typeof SCOPES)[number]["key"], boolean>>) => void;
  onStatusToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onToggle}>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{vendor.name}</span>
            <Badge variant={vendor.status === "active" ? "default" : "secondary"} className="capitalize">
              {vendor.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {vendor.contactEmail ?? "No contact email"} · Created {fmtDate(vendor.createdAt)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {SCOPES.map((s) => (
            <label key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={vendor[s.key] as boolean}
                onCheckedChange={(checked) => onScopeChange({ [s.key]: checked === true })}
              />
              {s.label}
            </label>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={onStatusToggle}>
          {vendor.status === "active" ? "Suspend" : "Reactivate"}
        </Button>
      </div>
    </div>
  );
}

function VendorDetail({
  vendor,
  onLinkMember,
  onUnlinkMember,
  onIssueKey,
  onRevokeKey,
  onCatalogFilterSave,
  onCatalogFilterClear,
}: {
  vendor: Vendor;
  onLinkMember: (email: string, onDone: () => void) => void;
  onUnlinkMember: (userId: number) => void;
  onIssueKey: (label: string, onDone: () => void) => void;
  onRevokeKey: (keyId: number) => void;
  onCatalogFilterSave: (catalogFilter: { songIds?: number[]; artists?: string[] }) => void;
  onCatalogFilterClear: () => void;
}) {
  const [memberEmail, setMemberEmail] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [catalogText, setCatalogText] = useState(
    vendor.catalogFilter ? JSON.stringify(vendor.catalogFilter, null, 2) : ""
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const handleSaveCatalogFilter = () => {
    if (!catalogText.trim()) {
      setCatalogError(null);
      onCatalogFilterClear();
      return;
    }
    try {
      const parsed = JSON.parse(catalogText);
      setCatalogError(null);
      onCatalogFilterSave(parsed);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <div className="mt-4 pt-4 border-t space-y-5">
      {/* Members */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Members</h4>
        <div className="space-y-1 mb-2">
          {vendor.members.length === 0 && <p className="text-xs text-muted-foreground">No members linked.</p>}
          {vendor.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between text-sm">
              <span>{m.email ?? `User #${m.userId}`}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onUnlinkMember(m.userId)}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            placeholder="Add member by email"
            className="h-8 text-sm max-w-xs"
          />
          <Button
            size="sm"
            disabled={!memberEmail.trim()}
            onClick={() => onLinkMember(memberEmail.trim(), () => setMemberEmail(""))}
          >
            Add member
          </Button>
        </div>
      </div>

      {/* Keys */}
      <div>
        <h4 className="text-sm font-semibold mb-2">API Keys</h4>
        <div className="space-y-1 mb-2">
          {vendor.keys.length === 0 && <p className="text-xs text-muted-foreground">No keys issued.</p>}
          {vendor.keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between text-sm">
              <div className="min-w-0">
                <span className="font-mono text-xs">
                  {k.prefix}…{k.last4}
                </span>
                <span className="ml-2 text-muted-foreground">{k.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  Created {fmtDate(k.createdAt)} · Last used {fmtDate(k.lastUsedAt)}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {k.revokedAt ? (
                  <Badge variant="destructive">Revoked</Badge>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => onRevokeKey(k.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={keyLabel}
            onChange={(e) => setKeyLabel(e.target.value)}
            placeholder="Key label"
            className="h-8 text-sm max-w-xs"
          />
          <Button
            size="sm"
            className="gap-1"
            disabled={!keyLabel.trim()}
            onClick={() => onIssueKey(keyLabel.trim(), () => setKeyLabel(""))}
          >
            <KeyRound className="w-3.5 h-3.5" /> Issue key
          </Button>
        </div>
      </div>

      {/* Catalog filter */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Catalog filter</h4>
        <p className="text-xs text-muted-foreground mb-2">
          JSON, e.g. <code>{`{"songIds":[1,2],"artists":["Some Artist"]}`}</code>. Leave blank and save to clear.
        </p>
        <Textarea
          value={catalogText}
          onChange={(e) => {
            setCatalogText(e.target.value);
            setCatalogError(null);
          }}
          placeholder='{"songIds":[],"artists":[]}'
          className="font-mono text-xs min-h-24"
        />
        {catalogError && <p className="text-xs text-destructive mt-1">Invalid JSON: {catalogError}</p>}
        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" onClick={handleSaveCatalogFilter}>
            Save filter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCatalogText("");
              setCatalogError(null);
              onCatalogFilterClear();
            }}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

function FreshKeyModal({
  freshKey,
  onDismiss,
}: {
  freshKey: { plaintext: string; prefix: string };
  onDismiss: () => void;
}) {
  const handleCopy = () => {
    navigator.clipboard
      .writeText(freshKey.plaintext)
      .then(() => toast.success("Copied to clipboard"))
      .catch(() => toast.error("Could not copy — copy it manually"));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="p-6 max-w-lg w-full space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">New API key</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDismiss}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm font-mono">
            {freshKey.plaintext}
          </code>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleCopy}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-sm font-medium text-destructive">
          This key is shown only once — store it now.
        </p>
        <Button className="w-full" onClick={onDismiss}>
          Done
        </Button>
      </Card>
    </div>
  );
}
