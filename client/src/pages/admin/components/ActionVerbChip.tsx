import { Badge } from "@/components/ui/badge";

const COLOR_BY_VERB: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  create: "default",
  update: "secondary",
  disable: "destructive",
  enable: "default",
  delete: "destructive",
  toggle: "secondary",
  usage_csv: "outline",
  usage_ddex: "outline",
  admin_actions_csv: "outline",
};

export function ActionVerbChip({ action }: { action: string }) {
  const [domain, verb] = action.split(".");
  const variant = COLOR_BY_VERB[verb] ?? "outline";
  return (
    <Badge variant={variant} className="font-mono text-xs">
      {domain}.{verb}
    </Badge>
  );
}
