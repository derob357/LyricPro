import { useLocation } from "wouter";
import { NoteBackground3D } from "@/components/NoteBackground3D";
import { Button } from "@/components/ui/button";

export default function Interstitial() {
  const [, navigate] = useLocation();
  return (
    <div className="relative min-h-screen text-foreground">
      <NoteBackground3D />
      <div className="container relative z-10 flex min-h-screen items-center justify-center">
        <Button data-testid="mydashboard-btn" variant="outline" onClick={() => navigate("/welcome")}>
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
