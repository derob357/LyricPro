// server/routers/adminVendors.ts
// Admin CRUD for vendor organisations, members, and API keys.
// All mutations are wrapped in a db.transaction so the write and the audit
// row succeed or fail atomically (follows the adminUsage.ts pattern).
import { z } from "zod";
import { eq, asc, and, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  vendors,
  vendorMembers,
  vendorApiKeys,
  users,
} from "../../drizzle/schema";
import { generateApiKey } from "../vendor/vendorAuth";
import { recordAdminAction } from "../_core/audit";

// ─── Pure guard helpers (exported for unit-testing) ──────────────────────────

export function activeKeyLimitReached(keys: { revokedAt: Date | null }[]): boolean {
  return keys.filter((k) => k.revokedAt === null).length >= 2;
}

export function memberLinkDecision(
  user: { id: number; role: string } | null,
): { ok: false; code: "NOT_FOUND" | "BAD_REQUEST" } | { ok: true; setRole: boolean } {
  if (!user) return { ok: false, code: "NOT_FOUND" };
  if (user.role === "admin") return { ok: false, code: "BAD_REQUEST" };
  return { ok: true, setRole: user.role !== "vendor" };
}

// ─── catalogFilter zod shape ──────────────────────────────────────────────────

const catalogFilterSchema = z
  .object({
    songIds: z.array(z.number().int()).max(500).optional(),
    artists: z.array(z.string().min(1).max(256)).max(100).optional(),
  })
  .nullable()
  .optional();

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminVendorsRouter = router({
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const allVendors = await db
      .select()
      .from(vendors)
      .orderBy(asc(vendors.createdAt));

    const allMembers = await db
      .select({
        id: vendorMembers.id,
        vendorId: vendorMembers.vendorId,
        userId: vendorMembers.userId,
        email: users.email,
      })
      .from(vendorMembers)
      .leftJoin(users, eq(vendorMembers.userId, users.id));

    // Explicitly omit keyHash from the select
    const allKeys = await db
      .select({
        id: vendorApiKeys.id,
        vendorId: vendorApiKeys.vendorId,
        label: vendorApiKeys.label,
        prefix: vendorApiKeys.keyPrefix,
        last4: vendorApiKeys.last4,
        createdAt: vendorApiKeys.createdAt,
        lastUsedAt: vendorApiKeys.lastUsedAt,
        revokedAt: vendorApiKeys.revokedAt,
      })
      .from(vendorApiKeys)
      .orderBy(asc(vendorApiKeys.createdAt));

    return allVendors.map((v) => ({
      ...v,
      members: allMembers
        .filter((m) => m.vendorId === v.id)
        .map(({ id, userId, email }) => ({ id, userId, email })),
      keys: allKeys.filter((k) => k.vendorId === v.id).map(({ vendorId: _v, ...k }) => k),
    }));
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        contactEmail: z.string().email().max(320).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.transaction(async (tx) => {
        const [v] = await tx
          .insert(vendors)
          .values({ name: input.name, contactEmail: input.contactEmail })
          .returning();
        await recordAdminAction({
          ctx,
          tx,
          action: "vendor.create",
          targetType: "vendor",
          targetId: String(v!.id),
          payload: { after: { name: input.name, contactEmail: input.contactEmail ?? null } },
        });
        return v!;
      });
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).max(128).optional(),
        contactEmail: z.string().email().max(320).nullable().optional(),
        status: z.enum(["active", "suspended"]).optional(),
        scopeGrowth: z.boolean().optional(),
        scopeEngagement: z.boolean().optional(),
        scopeContent: z.boolean().optional(),
        scopeMonetization: z.boolean().optional(),
        catalogFilter: catalogFilterSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { id, ...patch } = input;
      const set: Record<string, unknown> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.contactEmail !== undefined) set.contactEmail = patch.contactEmail;
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.scopeGrowth !== undefined) set.scopeGrowth = patch.scopeGrowth;
      if (patch.scopeEngagement !== undefined) set.scopeEngagement = patch.scopeEngagement;
      if (patch.scopeContent !== undefined) set.scopeContent = patch.scopeContent;
      if (patch.scopeMonetization !== undefined) set.scopeMonetization = patch.scopeMonetization;
      if (patch.catalogFilter !== undefined) set.catalogFilter = patch.catalogFilter;

      if (Object.keys(set).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      return db.transaction(async (tx) => {
        const [v] = await tx
          .update(vendors)
          .set(set)
          .where(eq(vendors.id, id))
          .returning();
        if (!v) throw new TRPCError({ code: "NOT_FOUND" });
        await recordAdminAction({
          ctx,
          tx,
          action: "vendor.update",
          targetType: "vendor",
          targetId: String(id),
          payload: { params: patch as Record<string, unknown> },
        });
        return v;
      });
    }),

  linkMember: adminProcedure
    .input(
      z.object({
        vendorId: z.number().int(),
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [found] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`);

      const decision = memberLinkDecision(found ?? null);
      if (!decision.ok) {
        throw new TRPCError({
          code: decision.code,
          message:
            decision.code === "NOT_FOUND"
              ? "No account with that email — ask them to sign up first"
              : "Admin accounts cannot be linked as vendor members",
        });
      }

      const userId = found!.id;

      const [vendorExists] = await db
        .select({ id: vendors.id })
        .from(vendors)
        .where(eq(vendors.id, input.vendorId));
      if (!vendorExists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
      }

      const [existingMembership] = await db
        .select({ id: vendorMembers.id })
        .from(vendorMembers)
        .where(eq(vendorMembers.userId, userId));
      if (existingMembership) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User is already linked to a vendor" });
      }

      // Unique constraint on vendorMembers.userId remains as a backstop, but the
      // checks above make it unreachable in normal (non-racing) flows.
      return db.transaction(async (tx) => {
        await tx
          .insert(vendorMembers)
          .values({ vendorId: input.vendorId, userId });
        if (decision.setRole) {
          await tx
            .update(users)
            .set({ role: "vendor" })
            .where(eq(users.id, userId));
        }
        await recordAdminAction({
          ctx,
          tx,
          action: "vendor.linkMember",
          targetType: "vendor",
          targetId: String(input.vendorId),
          payload: { params: { userId, email: input.email } },
        });
        return { userId };
      });
    }),

  unlinkMember: adminProcedure
    .input(
      z.object({
        vendorId: z.number().int(),
        userId: z.number().int(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(vendorMembers)
          .where(
            and(
              eq(vendorMembers.vendorId, input.vendorId),
              eq(vendorMembers.userId, input.userId),
            ),
          )
          .returning({ id: vendorMembers.id });

        // Idempotent no-op: no membership row for this (vendorId, userId) pair —
        // don't touch the user's role or record an audit row (mirrors revokeKey).
        if (deleted.length === 0) {
          return;
        }

        const [found] = await tx
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.id, input.userId));
        if (found && found.role === "vendor") {
          await tx
            .update(users)
            .set({ role: "user" })
            .where(eq(users.id, input.userId));
        }
        await recordAdminAction({
          ctx,
          tx,
          action: "vendor.unlinkMember",
          targetType: "vendor",
          targetId: String(input.vendorId),
          payload: { params: { userId: input.userId } },
        });
      });

      return { ok: true as const };
    }),

  issueKey: adminProcedure
    .input(
      z.object({
        vendorId: z.number().int(),
        label: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const keyData = generateApiKey();

      return db.transaction(async (tx) => {
        // Lock the vendor row first so concurrent issueKey calls for the same
        // vendor serialize — this closes the count-then-insert race where two
        // concurrent requests could both pass the 2-active-key check.
        const lockedResult = await tx.execute(
          sql`SELECT id FROM vendors WHERE id = ${input.vendorId} FOR UPDATE`,
        );
        const lockedRows = (lockedResult as any).rows ?? (Array.isArray(lockedResult) ? lockedResult : []);
        if (lockedRows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
        }

        const existingKeys = await tx
          .select({ revokedAt: vendorApiKeys.revokedAt })
          .from(vendorApiKeys)
          .where(eq(vendorApiKeys.vendorId, input.vendorId));

        if (activeKeyLimitReached(existingKeys)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Vendor already has 2 active keys — revoke one first",
          });
        }

        const [key] = await tx
          .insert(vendorApiKeys)
          .values({
            vendorId: input.vendorId,
            label: input.label,
            keyPrefix: keyData.prefix,
            last4: keyData.last4,
            keyHash: keyData.hash,
          })
          .returning({ id: vendorApiKeys.id });
        await recordAdminAction({
          ctx,
          tx,
          action: "vendor.issueKey",
          targetType: "vendor",
          targetId: String(input.vendorId),
          // NEVER log plaintext or hash — only safe identifiers
          payload: { params: { keyId: key!.id, prefix: keyData.prefix, last4: keyData.last4 } },
        });
        // plaintext is the ONLY time it leaves the server
        return { id: key!.id, plaintext: keyData.plaintext, prefix: keyData.prefix, last4: keyData.last4 };
      });
    }),

  revokeKey: adminProcedure
    .input(
      z.object({
        keyId: z.number().int(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Fetch to get vendorId and safe display fields for the audit row
      const [key] = await db
        .select({
          id: vendorApiKeys.id,
          vendorId: vendorApiKeys.vendorId,
          keyPrefix: vendorApiKeys.keyPrefix,
          last4: vendorApiKeys.last4,
          revokedAt: vendorApiKeys.revokedAt,
        })
        .from(vendorApiKeys)
        .where(eq(vendorApiKeys.id, input.keyId));

      // Idempotent: if already revoked or not found, just return ok
      if (!key || key.revokedAt !== null) {
        return { ok: true as const };
      }

      await db.transaction(async (tx) => {
        const updated = await tx
          .update(vendorApiKeys)
          .set({ revokedAt: new Date() })
          .where(and(eq(vendorApiKeys.id, input.keyId), isNull(vendorApiKeys.revokedAt)))
          .returning({ id: vendorApiKeys.id });

        // Idempotent no-op: another request already revoked it between our
        // read above and this update — skip the audit row.
        if (updated.length === 0) {
          return;
        }

        await recordAdminAction({
          ctx,
          tx,
          action: "vendor.revokeKey",
          targetType: "vendor",
          targetId: String(key.vendorId),
          payload: { params: { keyId: input.keyId, prefix: key.keyPrefix, last4: key.last4 } },
        });
      });

      return { ok: true as const };
    }),
});
