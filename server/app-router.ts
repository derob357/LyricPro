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
import { getDb } from "./db";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { createClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";

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
});

export type AppRouter = typeof appRouter;
