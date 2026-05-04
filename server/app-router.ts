import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { rateLimit } from "./_core/rateLimit";
import { gameRouter } from "./routers/game";
import { monetizationRouter } from "./routers/monetization";
import { monetizationIntegrationRouter } from "./routers/monetization-integration";
import { referralRouter } from "./routers/referral";
import { notificationRouter } from "./routers/notifications";
import { goldenNotesRouter } from "./routers/goldenNotes";
import { avatarsRouter } from "./routers/avatars";
import { insightsRouter } from "./routers/insights";
import { getDb } from "./db";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { createClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { sendMagicLinkEmail } from "./_core/sendMagicLinkEmail";
import { sendPasswordResetEmail } from "./_core/sendPasswordResetEmail";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      const key =
        opts.ctx.user?.id ?? opts.ctx.req.ip ?? "anonymous";
      rateLimit("auth.me", key, { max: 60, windowMs: 60_000 });
      return opts.ctx.user;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updateProfile: protectedProcedure
      .input(z.object({
        firstName: z.string().min(1).max(128),
        lastName: z.string().min(0).max(128),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.update(users).set({
          firstName: input.firstName,
          lastName: input.lastName || null,
        }).where(eq(users.openId, ctx.user.openId));
        return { success: true };
      }),

    // Public mutation: generate a magic-link URL with the Supabase
    // service-role key, then deliver it via Resend so we sidestep
    // Supabase's built-in email rate limit.
    //
    // Replaces the client-side `supabase.auth.signInWithOtp` for new and
    // returning users. Always returns a generic success shape regardless of
    // whether the email exists in our system, to avoid account enumeration.
    sendMagicLink: publicProcedure
      .input(z.object({
        email: z.string().email(),
        redirectTo: z.string().url().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Per-email cap stops one address from being spammed; per-IP cap
        // stops a single attacker from harvesting the whole user list.
        rateLimit(
          "auth.sendMagicLink.email",
          input.email.toLowerCase(),
          { max: 5, windowMs: 60 * 60_000 } // 5/hr per email
        );
        rateLimit(
          "auth.sendMagicLink.ip",
          ctx.req.ip ?? "anon",
          { max: 30, windowMs: 60 * 60_000 } // 30/hr per IP
        );

        const url = process.env.VITE_SUPABASE_PROJECT_URL;
        const secret = process.env.SUPABASE_SECRET_KEY;
        if (!url || !secret) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Auth not configured on server (missing Supabase env)",
          });
        }

        // Validate redirectTo against ALLOWED_ORIGINS so a forged Origin
        // can't trick us into emailing a phishing redirect URL. Mirrors
        // the Stripe checkout origin guard in goldenNotes.ts.
        const allowlist = (process.env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
        const claimedOrigin = ctx.req.headers.origin;
        const trustedOrigin =
          claimedOrigin && allowlist.includes(String(claimedOrigin))
            ? String(claimedOrigin)
            : "https://lyricpro-ai.vercel.app";
        const defaultRedirect = `${trustedOrigin}/auth/callback`;

        // If the caller passed a redirectTo, only honor it when it shares
        // an origin with the trusted one (handles native deep links via
        // a separately-allowlisted scheme upstream).
        let redirectTo = defaultRedirect;
        if (input.redirectTo) {
          try {
            const parsed = new URL(input.redirectTo);
            const trustedHost = new URL(trustedOrigin).host;
            if (parsed.host === trustedHost) {
              redirectTo = input.redirectTo;
            }
          } catch {
            // ignore — fall back to defaultRedirect
          }
        }

        const admin = createClient(url, secret, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data, error } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: input.email,
          options: { redirectTo },
        });
        if (error) {
          // Log internally but return generic success to the client to
          // avoid leaking which addresses are registered.
          console.error("[sendMagicLink] generateLink failed:", error.message);
          return { ok: true } as const;
        }

        const actionLink = data.properties?.action_link;
        if (!actionLink) {
          console.error("[sendMagicLink] no action_link in Supabase response");
          return { ok: true } as const;
        }

        try {
          await sendMagicLinkEmail({ to: input.email, magicLinkUrl: actionLink });
        } catch (err) {
          // Same rationale: log, swallow, return generic success. A real
          // configuration error (missing API key, unverified domain) will
          // surface in server logs immediately.
          console.error("[sendMagicLink] Resend send failed:", err instanceof Error ? err.message : err);
        }

        return { ok: true } as const;
      }),

    // Send a password-reset email via Resend, mirroring sendMagicLink.
    // Generates a recovery link with the Supabase service-role key, then
    // ships it through Resend. Always returns ok=true to prevent account
    // enumeration. The recovery URL lands on /auth/reset-password where
    // the user finishes the flow client-side.
    sendPasswordReset: publicProcedure
      .input(z.object({
        email: z.string().email(),
      }))
      .mutation(async ({ input, ctx }) => {
        rateLimit(
          "auth.sendPasswordReset.email",
          input.email.toLowerCase(),
          { max: 3, windowMs: 60 * 60_000 } // 3/hr per email
        );
        rateLimit(
          "auth.sendPasswordReset.ip",
          ctx.req.ip ?? "anon",
          { max: 20, windowMs: 60 * 60_000 } // 20/hr per IP
        );

        const url = process.env.VITE_SUPABASE_PROJECT_URL;
        const secret = process.env.SUPABASE_SECRET_KEY;
        if (!url || !secret) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Auth not configured on server (missing Supabase env)",
          });
        }

        const allowlist = (process.env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
        const claimedOrigin = ctx.req.headers.origin;
        const trustedOrigin =
          claimedOrigin && allowlist.includes(String(claimedOrigin))
            ? String(claimedOrigin)
            : "https://lyricpro-ai.vercel.app";
        const redirectTo = `${trustedOrigin}/auth/reset-password`;

        const admin = createClient(url, secret, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: input.email,
          options: { redirectTo },
        });
        if (error) {
          console.error("[sendPasswordReset] generateLink failed:", error.message);
          return { ok: true } as const;
        }

        const actionLink = data.properties?.action_link;
        if (!actionLink) {
          console.error("[sendPasswordReset] no action_link in Supabase response");
          return { ok: true } as const;
        }

        try {
          await sendPasswordResetEmail({ to: input.email, resetUrl: actionLink });
        } catch (err) {
          console.error(
            "[sendPasswordReset] Resend send failed:",
            err instanceof Error ? err.message : err
          );
        }

        return { ok: true } as const;
      }),

    // DEV-ONLY: skip Supabase's email rate limit by generating the magic
    // link URL server-side with the service-role key. Returns the clickable
    // URL so the dev can paste it into any browser. Gated on NODE_ENV and
    // rate-limited by email to prevent abuse even in dev.
    devGenerateMagicLink: publicProcedure
      .input(z.object({
        email: z.string().email(),
        redirectTo: z.string().url().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (process.env.NODE_ENV === "production") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "devGenerateMagicLink is disabled in production",
          });
        }
        rateLimit(
          "devGenerateMagicLink",
          input.email.toLowerCase(),
          { max: 20, windowMs: 60_000 }
        );

        const url = process.env.VITE_SUPABASE_PROJECT_URL;
        const secret = process.env.SUPABASE_SECRET_KEY;
        if (!url || !secret) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Supabase env not configured on server (VITE_SUPABASE_PROJECT_URL + SUPABASE_SECRET_KEY)",
          });
        }

        const admin = createClient(url, secret, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        // Default redirect mirrors the production magic-link flow so the
        // dev-generated link hits the same AuthCallback page.
        const host = ctx.req.headers["origin"] ?? "http://localhost:3000";
        const redirectTo =
          input.redirectTo ?? `${String(host)}/auth/callback`;

        const { data, error } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: input.email,
          options: { redirectTo },
        });
        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        }
        // data.properties.action_link is the https://...supabase.co/auth/v1
        // /verify?token=... URL that, when opened, redirects through to the
        // configured redirectTo with a valid session.
        return {
          actionLink: data.properties?.action_link ?? null,
          email: input.email,
        };
      }),
  }),
  game: gameRouter,
  monetization: monetizationRouter,
  monetizationIntegration: monetizationIntegrationRouter,
  referral: referralRouter,
  notifications: notificationRouter,
  goldenNotes: goldenNotesRouter,
  avatars: avatarsRouter,
  insights: insightsRouter,
});

export type AppRouter = typeof appRouter;
