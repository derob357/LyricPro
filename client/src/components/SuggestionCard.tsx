import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Lightbulb, ShoppingCart } from "lucide-react";

// Tracks dismissed suggestions per session so they don't reappear.
const dismissed = new Set<string>();

export function SuggestionCard() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.insights.getSuggestions.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (isLoading || !data) return null;

  const suggestions = [data.gameModeSuggestion, data.upsellSuggestion].filter(
    (s): s is NonNullable<typeof s> => s !== null && !dismissed.has(s.id) && !hidden.has(s.id),
  );

  if (suggestions.length === 0) return null;

  const dismiss = (id: string) => {
    dismissed.add(id);
    setHidden(prev => new Set(prev).add(id));
  };

  return (
    <div className="space-y-3">
      {suggestions.map(s => (
        <Card key={s.id} className="p-4 flex items-start gap-3 border-primary/20 bg-primary/5">
          <div className="mt-0.5 shrink-0">
            {s.category === "upsell" ? (
              <ShoppingCart className="w-4 h-4 text-amber-400" />
            ) : (
              <Lightbulb className="w-4 h-4 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">{s.text}</p>
            <Button
              variant="link"
              size="sm"
              className="px-0 h-auto mt-1 text-primary"
              onClick={() => navigate(s.action)}
            >
              Let's go
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => dismiss(s.id)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </Card>
      ))}
    </div>
  );
}
