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
import { getDb } from "./db";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";

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
  }),
  game: gameRouter,
  monetization: monetizationRouter,
  monetizationIntegration: monetizationIntegrationRouter,
  referral: referralRouter,
  notifications: notificationRouter,
});

export type AppRouter = typeof appRouter;
