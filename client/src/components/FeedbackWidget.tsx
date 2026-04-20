import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MessageCircle, Send, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
    type: "feedback" as "feedback" | "support" | "bug",
  });

  const submitMutation = trpc.system.submitFeedback.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
        setFormData({ name: "", email: "", message: "", type: "feedback" });
      }, 3000);
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to submit feedback");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.email.trim() || !formData.message.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    submitMutation.mutate(formData);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-110 transition-all duration-300 flex items-center justify-center glow-purple"
        title="Send feedback or request support"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-primary" />
              {submitted ? "Thank You!" : "Send Feedback"}
            </DialogTitle>
            <DialogDescription>
              {submitted
                ? "Thank you for your submission. A member of our team will respond within 24 hours."
                : "Help us improve LyricPro Ai. Share your feedback, request support, or report a bug."}
            </DialogDescription>
          </DialogHeader>

          {submitted ? (
            <div className="flex flex-col items-center justify-center py-8">
              <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
              <p className="text-center text-foreground font-medium mb-2">Submission Received</p>
              <p className="text-center text-muted-foreground text-sm">
                We appreciate your feedback and will be in touch soon.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-lg bg-card border border-border/50 text-foreground text-sm focus:outline-none focus:border-primary/50"
                >
                  <option value="feedback">Feedback</option>
                  <option value="support">Support Request</option>
                  <option value="bug">Bug Report</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Your name"
                  className="w-full px-3 py-2 rounded-lg bg-card border border-border/50 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 rounded-lg bg-card border border-border/50 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1 block">Message</label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Tell us what you think..."
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg bg-card border border-border/50 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
