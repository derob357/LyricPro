import { Music } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen text-foreground">
      <div className="container max-w-2xl py-16 space-y-6">
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-primary" />
          <h1 className="font-display text-3xl font-bold">Privacy Policy</h1>
        </div>
        <p className="text-muted-foreground text-sm">Last updated: June 10, 2026</p>
        <section className="space-y-3 text-sm leading-relaxed">
          <h2 className="font-semibold text-lg">What we collect</h2>
          <p>
            When you play as a guest we collect your email address to provide game access.
            When you create an account we store your profile details and gameplay statistics.
          </p>
          <h2 className="font-semibold text-lg">Marketing email</h2>
          <p>
            We only send tips, game updates, and promotions if you explicitly check the opt-in box.
            We record when you consented, the wording you saw, and the form you used, so we can honor
            your choice. You can unsubscribe at any time via the link in any email, and withdrawing
            consent stops marketing email without affecting your account.
          </p>
          <h2 className="font-semibold text-lg">What we don&apos;t do</h2>
          <p>We don&apos;t sell your personal information.</p>
          <h2 className="font-semibold text-lg">Contact</h2>
          <p>
            Questions about your data? Email{" "}
            <a
              href="mailto:support@playlyricpro.com"
              className="underline text-primary hover:text-primary/80"
            >
              support@playlyricpro.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
