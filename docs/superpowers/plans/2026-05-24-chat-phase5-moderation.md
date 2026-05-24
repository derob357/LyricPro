# Chat System — Phase 5: Full Moderation Tooling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote admin moderation from Phase 2's "minimal" (per-message `window.prompt` delete + ban) to a production-grade `/admin/chat` dashboard: mute mutations (visible + shadow), revoke ban, edit message with history snapshots, manage anyone's favorites, plus four read views — Activity feed, Bans table, Audit log, User lookup.

**Architecture:** Server-side additions all live under `chat.admin` (more mutations + queries) and a new `favorites.admin` sub-router. Client-side adds a single `/admin/chat` page with four sub-tabs powered by `<Tabs>`. The per-message `•••` menu from Phase 2 gets replaced with a proper modal that collects `reason` and (for ban/mute) `flavor` + `scope` + optional expiry; this same modal is reused on the dashboard's user-lookup detail panel.

**Tech Stack:** All of Phases 1-4 reused. No new dependencies. Uses `@/components/ui/dialog` (shadcn modal), `@/components/ui/table`, and the existing tabs/badge/button/input primitives.

**Reference spec:** [docs/superpowers/specs/2026-05-24-chat-system-design.md](../specs/2026-05-24-chat-system-design.md). Section 4 (Moderation) and Section 5.4 (admin tRPC surface).

---

## File structure

### Server

- Modify: `server/routers/chat.ts` — extend the `admin` sub-router with new mutations (`muteAuthor`, `revokeBan`, `editMessage`, `markFlaggedReviewed`) and new queries (`flaggedMessages`, `recentBans`, `auditLog`, `userLookup`).
- Modify: `server/routers/chat.endpoints.test.ts` — append integration tests for the new admin procedures.
- Modify: `server/routers/favorites.ts` — add `admin` sub-router with `addFor` + `removeFor` (admin-overrides for managing any user's favorites). Audit-logged.
- Modify: `server/routers/favorites.test.ts` — append admin-override tests.

### Client (new)

- Create: `client/src/components/chat/ModerationActionModal.tsx` — a single modal that handles **Delete**, **Mute (visible / shadow)**, and **Ban (global / per-room)** actions. Collects `reason`, optional `expiry`, and the action-specific scope/flavor. Replaces all `window.prompt(...)` flows from Phase 2.
- Create: `client/src/pages/admin/chat/AdminChatDashboard.tsx` — top-level `/admin/chat` page with four tabs.
- Create: `client/src/pages/admin/chat/ActivityTab.tsx` — flagged-message review queue.
- Create: `client/src/pages/admin/chat/BansTab.tsx` — list of active + recent bans with revoke button.
- Create: `client/src/pages/admin/chat/AuditLogTab.tsx` — paginated audit log with filters.
- Create: `client/src/pages/admin/chat/UserLookupTab.tsx` — search bar + detail panel for one user's favorites, bans, recent messages.

### Client (modified)

- Modify: `client/src/components/chat/ChatMessage.tsx` — add a third admin menu item ("Mute author"); replace direct `onAdminDelete` / `onAdminBan` callbacks with a unified `onAdminAction(action, target)` that opens the modal.
- Modify: `client/src/components/chat/ChatTabs.tsx` — render the new `<ModerationActionModal>` once; pass its `openWith(action, target)` callback down to `ChatMessageList` → `ChatMessage`.
- Modify: `client/src/App.tsx` — register the `/admin/chat` route.

---

## Task 1: Server — admin mutations (muteAuthor, revokeBan, editMessage, markFlaggedReviewed)

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `server/routers/chat.endpoints.test.ts`:

```ts
liveDescribe("chat.admin mutations — phase 5", () => {
  let adminId: number;
  let posterId: number;
  let messageId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [a] = await db!.insert(users).values({
      openId: `p5-admin-${ts}`,
      email: `p5-admin-${ts}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [p] = await db!.insert(users).values({
      openId: `p5-poster-${ts}`,
      email: `p5-poster-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    posterId = p.id;
    const [m] = await db!.insert(chatMessages).values({
      scope: "global",
      roomId: 1,
      authorId: posterId,
      body: "original body",
    }).returning();
    messageId = m.id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, posterId));
    await db!.delete(chatBans).where(eq(chatBans.userId, posterId));
    // audit + user leakage acceptable (immutable + FK)
  });

  const adminCaller = () =>
    appRouter.createCaller({
      user: { id: adminId, role: "admin", email: "p5-admin@example.com" },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("muteAuthor visible inserts mute_visible ban + audit log", async () => {
    const r = await adminCaller().chat.admin.muteAuthor({
      userId: posterId,
      scope: "global",
      flavor: "visible",
      reason: "rude",
    });
    expect(r.banId).toBeGreaterThan(0);
    const db = await getDb();
    const [row] = await db!.select().from(chatBans).where(eq(chatBans.id, r.banId));
    expect(row.action).toBe("mute_visible");
  });

  it("muteAuthor shadow inserts mute_shadow ban", async () => {
    const r = await adminCaller().chat.admin.muteAuthor({
      userId: posterId,
      scope: "global",
      flavor: "shadow",
      reason: "sockpuppet history",
    });
    expect(r.banId).toBeGreaterThan(0);
    const db = await getDb();
    const [row] = await db!.select().from(chatBans).where(eq(chatBans.id, r.banId));
    expect(row.action).toBe("mute_shadow");
  });

  it("revokeBan sets revoked_at + revoked_by + audit log", async () => {
    const db = await getDb();
    const [activeBan] = await db!
      .insert(chatBans)
      .values({
        userId: posterId,
        scope: "global",
        action: "ban",
        reason: "test",
        createdBy: adminId,
      })
      .returning();
    const r = await adminCaller().chat.admin.revokeBan({
      banId: activeBan.id,
      reason: "appeal accepted",
    });
    expect(r.success).toBe(true);

    const [updated] = await db!.select().from(chatBans).where(eq(chatBans.id, activeBan.id));
    expect(updated.revokedAt).not.toBeNull();
    expect(updated.revokedBy).toBe(adminId);
  });

  it("editMessage replaces body, sets edited_at/by, snapshots previous_body in audit log", async () => {
    const r = await adminCaller().chat.admin.editMessage({
      messageId,
      newBody: "redacted body",
      reason: "PII removal",
    });
    expect(r.success).toBe(true);

    const db = await getDb();
    const [updated] = await db!.select().from(chatMessages).where(eq(chatMessages.id, messageId));
    expect(updated.body).toBe("redacted body");
    expect(updated.editedAt).not.toBeNull();
    expect(updated.editedBy).toBe(adminId);

    const audit = await db!
      .select()
      .from(chatAuditLog)
      .where(and(eq(chatAuditLog.actorId, adminId), eq(chatAuditLog.action, "message_edit")));
    const matching = audit.find((row) => row.targetMessageId === messageId);
    expect(matching).toBeDefined();
    expect((matching!.metadata as { previous_body?: string } | null)?.previous_body).toBe("original body");
  });

  it("markFlaggedReviewed flips flag_status to reviewed_clean", async () => {
    const db = await getDb();
    const [flagged] = await db!
      .insert(chatMessages)
      .values({
        scope: "global",
        roomId: 1,
        authorId: posterId,
        body: "ambiguous content",
        flagStatus: "flagged",
        flagReason: "borderline",
      })
      .returning();
    try {
      const r = await adminCaller().chat.admin.markFlaggedReviewed({
        messageId: flagged.id,
        outcome: "clean",
        reason: "false positive",
      });
      expect(r.success).toBe(true);
      const [updated] = await db!.select().from(chatMessages).where(eq(chatMessages.id, flagged.id));
      expect(updated.flagStatus).toBe("reviewed_clean");
    } finally {
      await db!.delete(chatMessages).where(eq(chatMessages.id, flagged.id));
    }
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: 5 new tests FAIL (procedures don't exist).

- [ ] **Step 3: Add the procedures**

Edit `server/routers/chat.ts`. Inside the `admin: router({ ... })` block (added in Phase 2 Task 6), AFTER the existing `deleteMessage` and `banAuthor`, add:

```ts
    muteAuthor: adminProcedure
      .input(
        z.object({
          userId: z.number().int(),
          scope: z.enum(["global", "room"]),
          roomId: z.number().int().optional(),
          flavor: z.enum(["visible", "shadow"]).default("visible"),
          expiresAt: z.string().datetime().optional(),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        if (input.scope === "room" && input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for room-scope mute" });
        }

        const action = input.flavor === "shadow" ? "mute_shadow" : "mute_visible";

        const banId = await db.transaction(async (tx) => {
          const [ban] = await tx
            .insert(chatBans)
            .values({
              userId: input.userId,
              scope: input.scope,
              roomId: input.scope === "room" ? input.roomId! : null,
              action,
              reason: input.reason,
              createdBy: ctx.user.id,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            })
            .returning({ id: chatBans.id });
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action,
            targetUserId: input.userId,
            scope: input.scope,
            roomId: input.roomId ?? undefined,
            reason: input.reason,
            metadata: { expiresAt: input.expiresAt ?? null, flavor: input.flavor },
          });
          return ban.id;
        });
        return { banId };
      }),

    revokeBan: adminProcedure
      .input(z.object({ banId: z.number().int(), reason: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(chatBans)
            .where(eq(chatBans.id, input.banId));
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Ban not found" });
          if (existing.revokedAt != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Already revoked" });
          }

          await tx
            .update(chatBans)
            .set({ revokedAt: new Date(), revokedBy: ctx.user.id })
            .where(eq(chatBans.id, input.banId));

          const auditAction =
            existing.action === "ban" ? "unban" : "unmute";
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: auditAction,
            targetUserId: existing.userId,
            scope: existing.scope,
            roomId: existing.roomId ?? undefined,
            reason: input.reason,
            metadata: { ban_id: input.banId, original_action: existing.action },
          });
        });

        return { success: true as const };
      }),

    editMessage: adminProcedure
      .input(
        z.object({
          messageId: z.number().int(),
          newBody: z.string().min(1).max(1000),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.id, input.messageId));
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });

          await tx
            .update(chatMessages)
            .set({
              body: input.newBody,
              editedAt: new Date(),
              editedBy: ctx.user.id,
            })
            .where(eq(chatMessages.id, input.messageId));

          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "message_edit",
            targetMessageId: input.messageId,
            targetUserId: existing.authorId,
            scope: existing.scope,
            roomId: existing.roomId ?? undefined,
            reason: input.reason,
            metadata: { previous_body: existing.body, new_body: input.newBody },
          });
        });

        return { success: true as const };
      }),

    markFlaggedReviewed: adminProcedure
      .input(
        z.object({
          messageId: z.number().int(),
          outcome: z.enum(["clean", "delete"]),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.id, input.messageId));
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });

          if (input.outcome === "clean") {
            await tx
              .update(chatMessages)
              .set({ flagStatus: "reviewed_clean" })
              .where(eq(chatMessages.id, input.messageId));
          } else {
            await tx
              .update(chatMessages)
              .set({
                deletedAt: new Date(),
                deletedBy: ctx.user.id,
                deletedReason: input.reason,
              })
              .where(eq(chatMessages.id, input.messageId));
          }

          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: input.outcome === "clean" ? "message_edit" : "message_delete",
            targetMessageId: input.messageId,
            targetUserId: existing.authorId,
            scope: existing.scope,
            roomId: existing.roomId ?? undefined,
            reason: input.reason,
            metadata: { flag_review_outcome: input.outcome, original_flag_status: existing.flagStatus },
          });
        });

        return { success: true as const };
      }),
```

- [ ] **Step 4: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: all 5 new tests PASS.

- [ ] **Step 5: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): admin mutations — muteAuthor / revokeBan / editMessage / markFlaggedReviewed"
```

---

## Task 2: Server — admin queries (flaggedMessages, recentBans, auditLog, userLookup)

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `server/routers/chat.endpoints.test.ts`:

```ts
liveDescribe("chat.admin queries — phase 5", () => {
  let adminId: number;
  let targetId: number;
  let messageId: number;
  let flaggedId: number;
  let banId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [a] = await db!.insert(users).values({
      openId: `p5-q-admin-${ts}`,
      email: `p5-q-admin-${ts}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [t] = await db!.insert(users).values({
      openId: `p5-q-target-${ts}`,
      email: `p5-q-target-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    targetId = t.id;

    const [m] = await db!.insert(chatMessages).values({
      scope: "global",
      roomId: 1,
      authorId: targetId,
      body: "normal message",
    }).returning();
    messageId = m.id;

    const [flagged] = await db!.insert(chatMessages).values({
      scope: "global",
      roomId: 1,
      authorId: targetId,
      body: "borderline content",
      flagStatus: "flagged",
      flagReason: "obscenity tier-1 borderline",
    }).returning();
    flaggedId = flagged.id;

    const [ban] = await db!.insert(chatBans).values({
      userId: targetId,
      scope: "global",
      action: "ban",
      reason: "for testing",
      createdBy: adminId,
    }).returning();
    banId = ban.id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, targetId));
    await db!.delete(chatBans).where(eq(chatBans.userId, targetId));
  });

  const adminCaller = () =>
    appRouter.createCaller({
      user: { id: adminId, role: "admin", email: "p5-q-admin@example.com" },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("flaggedMessages returns flagged + flagged_high_confidence rows", async () => {
    const r = await adminCaller().chat.admin.flaggedMessages({ limit: 50 });
    expect(r.map((m) => m.id)).toContain(flaggedId);
    expect(r.map((m) => m.id)).not.toContain(messageId); // clean message not flagged
  });

  it("recentBans returns active bans", async () => {
    const r = await adminCaller().chat.admin.recentBans({ limit: 100 });
    expect(r.map((b) => b.id)).toContain(banId);
  });

  it("auditLog returns rows filtered by actor", async () => {
    const r = await adminCaller().chat.admin.auditLog({ actorId: adminId, limit: 50 });
    // The Phase 4 chatAudit tests already left some rows for various admins;
    // we just verify our targeted query works without erroring.
    expect(Array.isArray(r.rows)).toBe(true);
  });

  it("userLookup finds users by email substring", async () => {
    const r = await adminCaller().chat.admin.userLookup({ query: `p5-q-target` });
    expect(r.users.length).toBeGreaterThanOrEqual(1);
    const found = r.users.find((u) => u.id === targetId);
    expect(found).toBeDefined();
    expect(found!.activeBanCount).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Add the queries**

Edit `server/routers/chat.ts`. Inside the `admin: router({...})` block, AFTER the mutations from Task 1, add:

```ts
    flaggedMessages: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const rows = await db
          .select()
          .from(chatMessages)
          .where(
            and(
              isNull(chatMessages.deletedAt),
              sql`${chatMessages.flagStatus} IN ('flagged', 'flagged_high_confidence')`,
            ),
          )
          .orderBy(desc(chatMessages.id))
          .limit(input.limit);
        return rows;
      }),

    recentBans: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const rows = await db
          .select()
          .from(chatBans)
          .where(isNull(chatBans.revokedAt))
          .orderBy(desc(chatBans.createdAt))
          .limit(input.limit);
        return rows;
      }),

    auditLog: adminProcedure
      .input(
        z.object({
          actorId: z.number().int().optional(),
          action: z.string().optional(),
          targetUserId: z.number().int().optional(),
          beforeId: z.number().int().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const where = [] as ReturnType<typeof sql>[];
        if (input.actorId != null) where.push(sql`actor_id = ${input.actorId}`);
        if (input.action) where.push(sql`action = ${input.action}`);
        if (input.targetUserId != null) where.push(sql`target_user_id = ${input.targetUserId}`);
        if (input.beforeId != null) where.push(sql`id < ${input.beforeId}`);
        const whereClause = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
        const result = await db.execute(sql`
          SELECT * FROM chat_audit_log
          ${whereClause}
          ORDER BY id DESC
          LIMIT ${input.limit}
        `);
        const rows = ((result as unknown as { rows?: unknown[] }).rows
          ?? (Array.isArray(result) ? (result as unknown[]) : [])) as Array<Record<string, unknown>>;
        return { rows };
      }),

    userLookup: adminProcedure
      .input(z.object({ query: z.string().min(1).max(128) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const result = await db.execute(sql`
          SELECT
            u.id, u."openId", u.email, u."firstName", u."lastName", u.role,
            (
              SELECT COUNT(*)::int FROM chat_bans b
              WHERE b.user_id = u.id
                AND b.revoked_at IS NULL
                AND (b.expires_at IS NULL OR b.expires_at > NOW())
            ) AS "activeBanCount"
          FROM users u
          WHERE u.email ILIKE ${"%" + input.query + "%"}
             OR u."firstName" ILIKE ${"%" + input.query + "%"}
             OR u."lastName" ILIKE ${"%" + input.query + "%"}
          ORDER BY u.id DESC
          LIMIT 25
        `);
        const userRows = ((result as unknown as { rows?: unknown[] }).rows
          ?? (Array.isArray(result) ? (result as unknown[]) : [])) as Array<{
          id: number;
          openId: string;
          email: string | null;
          firstName: string | null;
          lastName: string | null;
          role: string;
          activeBanCount: number;
        }>;
        return { users: userRows };
      }),
```

- [ ] **Step 4: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: all 4 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): admin queries — flaggedMessages / recentBans / auditLog / userLookup"
```

---

## Task 3: Server — favorites.admin sub-router

**Files:**
- Modify: `server/routers/favorites.ts`
- Modify: `server/routers/favorites.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `server/routers/favorites.test.ts` (outside any existing `liveDescribe`):

```ts
liveDescribe("favorites.admin overrides", () => {
  let adminId: number;
  let aliceId: number;
  let bobId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const seeded = await db!.insert(users).values([
      { openId: `fav-admin-${ts}`, email: `fav-admin-${ts}@example.com`, loginMethod: "vitest", role: "admin" },
      { openId: `fav-alice2-${ts}`, email: `fav-alice2-${ts}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `fav-bob2-${ts}`, email: `fav-bob2-${ts}@example.com`, loginMethod: "vitest", role: "user" },
    ]).returning();
    adminId = seeded[0].id;
    aliceId = seeded[1].id;
    bobId = seeded[2].id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(userFavorites).where(
      or(
        inArray(userFavorites.followerId, [adminId, aliceId, bobId]),
        inArray(userFavorites.favoriteId, [adminId, aliceId, bobId]),
      ),
    );
    await db!.delete(users).where(inArray(users.id, [aliceId, bobId]));
    // admin user left behind (chat_audit_log FK)
  });

  const adminCaller = () =>
    appRouter.createCaller({
      user: { id: adminId, role: "admin", email: "fav-admin@example.com" },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  const userCaller = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("admin.addFor makes alice follow bob on alice's behalf", async () => {
    const r = await adminCaller().favorites.admin.addFor({
      ownerId: aliceId,
      favoriteId: bobId,
      reason: "moderator override",
    });
    expect(r.added).toBe(true);

    // Confirm alice's list now contains bob
    const aliceList = await userCaller(aliceId).favorites.list();
    expect(aliceList.map((f) => f.favoriteId)).toContain(bobId);
  });

  it("admin.removeFor removes the edge and writes audit log", async () => {
    const r = await adminCaller().favorites.admin.removeFor({
      ownerId: aliceId,
      favoriteId: bobId,
      reason: "harassment cleanup",
    });
    expect(r.removed).toBe(true);
    const aliceList = await userCaller(aliceId).favorites.list();
    expect(aliceList.map((f) => f.favoriteId)).not.toContain(bobId);
  });

  it("non-admin cannot call admin overrides", async () => {
    await expect(
      // @ts-expect-error: non-admin caller should be denied at runtime
      userCaller(aliceId).favorites.admin.addFor({ ownerId: bobId, favoriteId: aliceId, reason: "x" }),
    ).rejects.toThrow();
  });
});
```

Also ensure `or` is imported from `drizzle-orm` at the top of `favorites.test.ts` if not already.

- [ ] **Step 2: Add the admin sub-router**

Edit `server/routers/favorites.ts`. After the existing `favoritesRouter` definition (or as part of it), wire up the admin sub-router:

```ts
import { adminProcedure } from "../_core/trpc";
import { recordChatAction } from "../_core/chatAudit";

const adminSubRouter = router({
  addFor: adminProcedure
    .input(z.object({ ownerId: z.number().int(), favoriteId: z.number().int(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (input.ownerId === input.favoriteId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot self-favorite." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const ins = await tx
          .insert(userFavorites)
          .values({ followerId: input.ownerId, favoriteId: input.favoriteId })
          .onConflictDoNothing()
          .returning({ id: userFavorites.id });
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "favorite_added",
          targetUserId: input.ownerId,
          reason: input.reason,
          metadata: { affected_user: input.favoriteId },
        });
        return { added: ins.length > 0 };
      });

      return result;
    }),

  removeFor: adminProcedure
    .input(z.object({ ownerId: z.number().int(), favoriteId: z.number().int(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const del = await tx
          .delete(userFavorites)
          .where(
            and(
              eq(userFavorites.followerId, input.ownerId),
              eq(userFavorites.favoriteId, input.favoriteId),
            ),
          )
          .returning({ id: userFavorites.id });
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "favorite_removed",
          targetUserId: input.ownerId,
          reason: input.reason,
          metadata: { affected_user: input.favoriteId },
        });
        return { removed: del.length > 0 };
      });

      return result;
    }),
});
```

Then add `admin: adminSubRouter` inside the existing `favoritesRouter = router({ ... })` definition.

Also confirm that `and`, `TRPCError` are already imported at the top of `favorites.ts`. Add if missing.

- [ ] **Step 3: Run tests**

```bash
set -a; source .env; set +a; pnpm test:server -- favorites.test
```

Expected: prior 9 + 3 new = 12 PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routers/favorites.ts server/routers/favorites.test.ts
git commit -m "feat(chat): favorites.admin sub-router — addFor / removeFor with audit log"
```

---

## Task 4: Client — `<ModerationActionModal>` component

**Files:**
- Create: `client/src/components/chat/ModerationActionModal.tsx`

- [ ] **Step 1: Create the modal**

Create `client/src/components/chat/ModerationActionModal.tsx`:

```tsx
import { useState, useEffect, type FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ModerationAction =
  | { kind: "delete"; messageId: number }
  | { kind: "edit"; messageId: number; currentBody: string }
  | { kind: "ban"; userId: number }
  | { kind: "mute"; userId: number };

export type ModerationActionResult =
  | { kind: "delete"; messageId: number; reason: string }
  | { kind: "edit"; messageId: number; newBody: string; reason: string }
  | { kind: "ban"; userId: number; scope: "global" | "room"; roomId?: number; expiresAt?: string; reason: string }
  | { kind: "mute"; userId: number; scope: "global" | "room"; roomId?: number; flavor: "visible" | "shadow"; expiresAt?: string; reason: string };

interface Props {
  action: ModerationAction | null;
  contextRoomId?: number;  // current chat room — defaults the per-room scope
  onClose: () => void;
  onSubmit: (result: ModerationActionResult) => Promise<void>;
}

export function ModerationActionModal({ action, contextRoomId, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const [newBody, setNewBody] = useState("");
  const [scope, setScope] = useState<"global" | "room">("global");
  const [flavor, setFlavor] = useState<"visible" | "shadow">("visible");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (action == null) return;
    setReason("");
    setNewBody(action.kind === "edit" ? action.currentBody : "");
    setScope("global");
    setFlavor("visible");
    setExpiresAt("");
    setSubmitting(false);
  }, [action]);

  if (action == null) return null;

  const title =
    action.kind === "delete" ? "Delete message"
    : action.kind === "edit" ? "Edit message"
    : action.kind === "ban" ? "Ban author"
    : "Mute author";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : undefined;
      const roomId = scope === "room" ? contextRoomId : undefined;
      if (action.kind === "delete") {
        await onSubmit({ kind: "delete", messageId: action.messageId, reason });
      } else if (action.kind === "edit") {
        await onSubmit({ kind: "edit", messageId: action.messageId, newBody, reason });
      } else if (action.kind === "ban") {
        await onSubmit({ kind: "ban", userId: action.userId, scope, roomId, expiresAt: expiresIso, reason });
      } else {
        await onSubmit({ kind: "mute", userId: action.userId, scope, roomId, flavor, expiresAt: expiresIso, reason });
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {action.kind === "edit" && (
            <div>
              <Label htmlFor="mod-body">New body</Label>
              <Textarea id="mod-body" value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={3} required maxLength={1000} />
            </div>
          )}
          {(action.kind === "ban" || action.kind === "mute") && (
            <>
              <div>
                <Label htmlFor="mod-scope">Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as "global" | "room")}>
                  <SelectTrigger id="mod-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global (all chat)</SelectItem>
                    {contextRoomId != null && (
                      <SelectItem value="room">This room only</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {action.kind === "mute" && (
                <div>
                  <Label htmlFor="mod-flavor">Flavor</Label>
                  <Select value={flavor} onValueChange={(v) => setFlavor(v as "visible" | "shadow")}>
                    <SelectTrigger id="mod-flavor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visible">Visible (user sees they can't post)</SelectItem>
                      <SelectItem value="shadow">Shadow (user thinks they posted; no one else sees it)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="mod-expires">Expires at (optional)</Label>
                <Input id="mod-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="mod-reason">Reason (required)</Label>
            <Textarea id="mod-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required minLength={1} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !reason.trim()}>
              {submitting ? "Working..." : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/ModerationActionModal.tsx
git commit -m "feat(chat): unified ModerationActionModal (delete/edit/ban/mute) replacing window.prompt"
```

---

## Task 5: Client — wire ChatMessage + ChatTabs to use the modal + add Mute action

**Files:**
- Modify: `client/src/components/chat/ChatMessage.tsx`
- Modify: `client/src/components/chat/ChatMessageList.tsx`
- Modify: `client/src/components/chat/ChatTabs.tsx`

- [ ] **Step 1: Refactor `ChatMessage` to use a unified action callback**

Edit `client/src/components/chat/ChatMessage.tsx`. Replace the existing `onAdminDelete` / `onAdminBan` props with a single `onAdminAction` callback, and add "Edit" + "Mute author" menu items.

Find the existing `Props` interface:
```tsx
interface Props {
  message: ChatMessageShape;
  viewerId: number | null;
  viewerRole: "user" | "admin" | null;
  onAdminDelete?: (messageId: number) => void;
  onAdminBan?: (authorId: number) => void;
}
```

Replace with:
```tsx
import { type ModerationAction } from "./ModerationActionModal";

interface Props {
  message: ChatMessageShape;
  viewerId: number | null;
  viewerRole: "user" | "admin" | null;
  onAdminAction?: (action: ModerationAction) => void;
}
```

Update the destructure: `({ message, viewerId, viewerRole, onAdminAction })`.

Replace the existing two `DropdownMenuItem` lines:
```tsx
              <DropdownMenuItem onClick={() => onAdminDelete?.(message.id)}>
                Delete message
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAdminBan?.(message.authorId)}
                className="text-destructive"
              >
                Ban author (global)
              </DropdownMenuItem>
```

…with four items:
```tsx
              <DropdownMenuItem onClick={() => onAdminAction?.({ kind: "delete", messageId: message.id })}>
                Delete message
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAdminAction?.({ kind: "edit", messageId: message.id, currentBody: message.body })}>
                Edit message
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAdminAction?.({ kind: "mute", userId: message.authorId })}>
                Mute author
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAdminAction?.({ kind: "ban", userId: message.authorId })}
                className="text-destructive"
              >
                Ban author
              </DropdownMenuItem>
```

- [ ] **Step 2: Update `ChatMessageList` to thread the new callback**

Edit `client/src/components/chat/ChatMessageList.tsx`. Find the Props:
```tsx
  onAdminDelete?: (messageId: number) => void;
  onAdminBan?: (authorId: number) => void;
```
Replace with:
```tsx
  onAdminAction?: (action: import("./ModerationActionModal").ModerationAction) => void;
```

Inside `<ChatMessage>` rendering, replace:
```tsx
              onAdminDelete={onAdminDelete}
              onAdminBan={onAdminBan}
```
with:
```tsx
              onAdminAction={onAdminAction}
```

Drop the old prop destructure (`onAdminDelete`, `onAdminBan`) from the function signature; add `onAdminAction`.

- [ ] **Step 3: Update `ChatTabs` to render the modal + dispatch all admin actions through it**

Edit `client/src/components/chat/ChatTabs.tsx`.

1. Add imports near the top:
```tsx
import { ModerationActionModal, type ModerationAction, type ModerationActionResult } from "./ModerationActionModal";
```

2. Inside the component body, near the other mutations, add:
```tsx
const editMutation = trpc.chat.admin.editMessage.useMutation();
const muteMutation = trpc.chat.admin.muteAuthor.useMutation();
const [pendingAction, setPendingAction] = useState<ModerationAction | null>(null);
```

3. Replace the existing `handleAdminDelete` and `handleAdminBan` with a single `handleAdminAction` that opens the modal:
```tsx
const handleAdminAction = (action: ModerationAction) => {
  setPendingAction(action);
};

const performAction = async (result: ModerationActionResult) => {
  try {
    if (result.kind === "delete") {
      await deleteMutation.mutateAsync({ messageId: result.messageId, reason: result.reason });
      toast.success("Message deleted");
    } else if (result.kind === "edit") {
      await editMutation.mutateAsync({ messageId: result.messageId, newBody: result.newBody, reason: result.reason });
      toast.success("Message edited");
    } else if (result.kind === "ban") {
      await banMutation.mutateAsync({
        userId: result.userId,
        scope: result.scope,
        roomId: result.roomId,
        expiresAt: result.expiresAt,
        reason: result.reason,
      });
      toast.success(`User #${result.userId} banned`);
    } else {
      await muteMutation.mutateAsync({
        userId: result.userId,
        scope: result.scope,
        roomId: result.roomId,
        flavor: result.flavor,
        expiresAt: result.expiresAt,
        reason: result.reason,
      });
      toast.success(`User #${result.userId} muted (${result.flavor})`);
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Action failed");
    throw err;
  }
};
```

4. Compute the current contextRoomId (the chat's roomId when the active tab has one — global or tournament):
```tsx
const contextRoomId =
  tab === "global" ? GLOBAL_ROOM_ID
  : tab === "tournament" ? (activeTournamentId ?? undefined)
  : undefined;
```

5. Replace every `onAdminDelete` / `onAdminBan` prop passed to `<ChatMessageList>` with `onAdminAction={handleAdminAction}`. There are typically 2-3 call sites (Global, Friends, Tournament). Update them all.

6. At the bottom of the component's JSX (just before the closing `</Tabs>` or alongside whatever wrapper renders), add the modal:
```tsx
<ModerationActionModal
  action={pendingAction}
  contextRoomId={contextRoomId}
  onClose={() => setPendingAction(null)}
  onSubmit={performAction}
/>
```

- [ ] **Step 4: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/chat/ChatMessage.tsx client/src/components/chat/ChatMessageList.tsx client/src/components/chat/ChatTabs.tsx
git commit -m "feat(chat): per-message admin actions via ModerationActionModal (delete/edit/mute/ban)"
```

---

## Task 6: Client — `/admin/chat` dashboard shell + Activity tab

**Files:**
- Create: `client/src/pages/admin/chat/AdminChatDashboard.tsx`
- Create: `client/src/pages/admin/chat/ActivityTab.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create the dashboard shell**

Create `client/src/pages/admin/chat/AdminChatDashboard.tsx`:

```tsx
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActivityTab } from "./ActivityTab";
import { BansTab } from "./BansTab";
import { AuditLogTab } from "./AuditLogTab";
import { UserLookupTab } from "./UserLookupTab";

type DashboardTab = "activity" | "bans" | "audit" | "users";

export default function AdminChatDashboard() {
  const [tab, setTab] = useState<DashboardTab>("activity");

  return (
    <div className="container max-w-5xl py-6">
      <h1 className="text-2xl font-bold mb-4">Chat Moderation</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as DashboardTab)}>
        <TabsList className="grid grid-cols-4">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="bans">Bans</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="users">User Lookup</TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
        <TabsContent value="bans" className="mt-4">
          <BansTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditLogTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UserLookupTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Create the Activity tab**

Create `client/src/pages/admin/chat/ActivityTab.tsx`:

```tsx
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function ActivityTab() {
  const utils = trpc.useUtils();
  const flagged = trpc.chat.admin.flaggedMessages.useQuery({ limit: 100 });
  const reviewMut = trpc.chat.admin.markFlaggedReviewed.useMutation();

  const handleReview = async (messageId: number, outcome: "clean" | "delete") => {
    const reason = prompt(`Reason for marking ${outcome}?`);
    if (!reason) return;
    try {
      await reviewMut.mutateAsync({ messageId, outcome, reason });
      void utils.chat.admin.flaggedMessages.invalidate();
      toast.success(`Marked ${outcome}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    }
  };

  return (
    <div className="grid gap-2">
      <h2 className="font-semibold text-sm text-muted-foreground">Flagged messages awaiting review</h2>
      {flagged.isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {flagged.data && flagged.data.length === 0 && (
        <p className="text-muted-foreground text-sm">Nothing flagged. Quiet day.</p>
      )}
      {(flagged.data ?? []).map((m) => (
        <Card key={m.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>id #{m.id}</span>
                <span>author #{m.authorId}</span>
                <span>{m.scope}</span>
                <Badge variant="secondary">{m.flagStatus}</Badge>
                <span>{new Date(m.createdAt as unknown as string).toLocaleString()}</span>
              </div>
              <p className="text-sm mt-1 break-words">{m.body}</p>
              {m.flagReason && <p className="text-xs text-muted-foreground italic mt-0.5">{m.flagReason}</p>}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => handleReview(m.id, "clean")}>
                Mark clean
              </Button>
              <Button size="sm" variant="destructive" onClick={() => handleReview(m.id, "delete")}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Stub the other three tabs so the dashboard compiles**

Create `client/src/pages/admin/chat/BansTab.tsx`:
```tsx
export function BansTab() {
  return <p className="text-sm text-muted-foreground">Loading bans... (Task 7)</p>;
}
```

Create `client/src/pages/admin/chat/AuditLogTab.tsx`:
```tsx
export function AuditLogTab() {
  return <p className="text-sm text-muted-foreground">Loading audit log... (Task 8)</p>;
}
```

Create `client/src/pages/admin/chat/UserLookupTab.tsx`:
```tsx
export function UserLookupTab() {
  return <p className="text-sm text-muted-foreground">Loading user lookup... (Task 9)</p>;
}
```

- [ ] **Step 4: Register the route**

Edit `client/src/App.tsx`. Add import:
```tsx
import AdminChatDashboard from "@/pages/admin/chat/AdminChatDashboard";
```

Inside the `<Switch>` (near other `/admin/*` routes):
```tsx
<Route path="/admin/chat" component={AdminChatDashboard} />
```

- [ ] **Step 5: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/chat/ client/src/App.tsx
git commit -m "feat(chat): /admin/chat dashboard shell + Activity tab (flagged review queue)"
```

---

## Task 7: Client — Bans tab

**Files:**
- Modify: `client/src/pages/admin/chat/BansTab.tsx`

- [ ] **Step 1: Implement the tab**

Replace `client/src/pages/admin/chat/BansTab.tsx`:

```tsx
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function BansTab() {
  const utils = trpc.useUtils();
  const bans = trpc.chat.admin.recentBans.useQuery({ limit: 100 });
  const revokeMut = trpc.chat.admin.revokeBan.useMutation();

  const handleRevoke = async (banId: number) => {
    const reason = prompt("Reason for revoking?");
    if (!reason) return;
    try {
      await revokeMut.mutateAsync({ banId, reason });
      void utils.chat.admin.recentBans.invalidate();
      toast.success("Ban revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  return (
    <div className="grid gap-2">
      <h2 className="font-semibold text-sm text-muted-foreground">Active bans &amp; mutes</h2>
      {bans.isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {bans.data && bans.data.length === 0 && (
        <p className="text-muted-foreground text-sm">No active bans or mutes.</p>
      )}
      {(bans.data ?? []).map((b) => {
        const expired = b.expiresAt != null && new Date(b.expiresAt as unknown as string) < new Date();
        return (
          <Card key={b.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>id #{b.id}</span>
                  <span>user #{b.userId}</span>
                  <Badge variant={b.action === "ban" ? "destructive" : "secondary"}>{b.action}</Badge>
                  <Badge variant="outline">{b.scope}{b.roomId ? ` room=${b.roomId}` : ""}</Badge>
                  {expired && <Badge variant="outline">expired</Badge>}
                  <span>by #{b.createdBy}</span>
                  <span>{new Date(b.createdAt as unknown as string).toLocaleString()}</span>
                </div>
                <p className="text-sm mt-1">{b.reason}</p>
                {b.expiresAt && (
                  <p className="text-xs text-muted-foreground">
                    Expires: {new Date(b.expiresAt as unknown as string).toLocaleString()}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => handleRevoke(b.id)}>
                Revoke
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/admin/chat/BansTab.tsx
git commit -m "feat(chat): Bans tab with revoke action"
```

---

## Task 8: Client — Audit Log tab

**Files:**
- Modify: `client/src/pages/admin/chat/AuditLogTab.tsx`

- [ ] **Step 1: Implement the tab**

Replace `client/src/pages/admin/chat/AuditLogTab.tsx`:

```tsx
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuditLogTab() {
  const [actorIdInput, setActorIdInput] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [targetIdInput, setTargetIdInput] = useState("");

  const filters = {
    actorId: actorIdInput ? parseInt(actorIdInput, 10) : undefined,
    action: actionInput || undefined,
    targetUserId: targetIdInput ? parseInt(targetIdInput, 10) : undefined,
    limit: 100,
  };

  const log = trpc.chat.admin.auditLog.useQuery(filters);

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor="filter-actor">Actor user id</Label>
          <Input id="filter-actor" value={actorIdInput} onChange={(e) => setActorIdInput(e.target.value)} placeholder="any" />
        </div>
        <div>
          <Label htmlFor="filter-action">Action</Label>
          <Input id="filter-action" value={actionInput} onChange={(e) => setActionInput(e.target.value)} placeholder="ban / message_delete / ..." />
        </div>
        <div>
          <Label htmlFor="filter-target">Target user id</Label>
          <Input id="filter-target" value={targetIdInput} onChange={(e) => setTargetIdInput(e.target.value)} placeholder="any" />
        </div>
      </div>
      <h2 className="font-semibold text-sm text-muted-foreground">Audit log (latest 100)</h2>
      {log.isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {log.data && log.data.rows.length === 0 && (
        <p className="text-muted-foreground text-sm">No rows match.</p>
      )}
      {(log.data?.rows ?? []).map((rawRow) => {
        const r = rawRow as Record<string, unknown>;
        return (
          <Card key={String(r.id)} className="p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">#{String(r.id)}</span>
              <span>{new Date(String(r.createdAt ?? r.created_at)).toLocaleString()}</span>
              <span className="font-semibold">{String(r.action)}</span>
              <span>actor #{String(r.actor_id ?? r.actorId)}</span>
              {r.target_user_id != null && <span>target user #{String(r.target_user_id)}</span>}
              {r.target_message_id != null && <span>msg #{String(r.target_message_id)}</span>}
              {r.target_tournament_id != null && <span>tournament #{String(r.target_tournament_id)}</span>}
            </div>
            {r.reason != null && <p className="mt-1">{String(r.reason)}</p>}
            {r.metadata != null && (
              <pre className="mt-1 bg-muted/30 rounded p-1 overflow-x-auto">{JSON.stringify(r.metadata, null, 2)}</pre>
            )}
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/admin/chat/AuditLogTab.tsx
git commit -m "feat(chat): Audit Log tab with actor/action/target filters"
```

---

## Task 9: Client — User Lookup tab

**Files:**
- Modify: `client/src/pages/admin/chat/UserLookupTab.tsx`

- [ ] **Step 1: Implement the tab**

Replace `client/src/pages/admin/chat/UserLookupTab.tsx`:

```tsx
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function UserLookupTab() {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const lookup = trpc.chat.admin.userLookup.useQuery(
    { query: submittedQuery },
    { enabled: submittedQuery.length >= 1 },
  );
  const addFor = trpc.favorites.admin.addFor.useMutation();
  const removeFor = trpc.favorites.admin.removeFor.useMutation();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  };

  const handleAddFor = async (ownerId: number) => {
    const favIdRaw = prompt(`Add favorite (user id) to user #${ownerId}'s list?`);
    if (!favIdRaw) return;
    const favoriteId = parseInt(favIdRaw, 10);
    if (Number.isNaN(favoriteId)) return;
    const reason = prompt("Reason?") ?? "admin override";
    try {
      await addFor.mutateAsync({ ownerId, favoriteId, reason });
      void utils.chat.admin.userLookup.invalidate();
      toast.success(`Added user #${favoriteId} to #${ownerId}'s favorites`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleRemoveFor = async (ownerId: number) => {
    const favIdRaw = prompt(`Remove favorite (user id) from user #${ownerId}'s list?`);
    if (!favIdRaw) return;
    const favoriteId = parseInt(favIdRaw, 10);
    if (Number.isNaN(favoriteId)) return;
    const reason = prompt("Reason?") ?? "admin override";
    try {
      await removeFor.mutateAsync({ ownerId, favoriteId, reason });
      void utils.chat.admin.userLookup.invalidate();
      toast.success(`Removed user #${favoriteId} from #${ownerId}'s favorites`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="grid gap-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="lookup-query" className="sr-only">Search</Label>
          <Input
            id="lookup-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email, first name, or last name..."
          />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {lookup.isLoading && submittedQuery && <p className="text-muted-foreground text-sm">Searching...</p>}
      {lookup.data && lookup.data.users.length === 0 && submittedQuery && (
        <p className="text-muted-foreground text-sm">No users match.</p>
      )}
      {(lookup.data?.users ?? []).map((u) => (
        <Card key={u.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{u.email ?? `user #${u.id}`}</span>
                <Badge variant="outline">id {u.id}</Badge>
                {u.role === "admin" && <Badge>admin</Badge>}
                {u.activeBanCount > 0 && (
                  <Badge variant="destructive">{u.activeBanCount} active ban{u.activeBanCount === 1 ? "" : "s"}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {u.firstName} {u.lastName} - openId: <span className="font-mono">{u.openId}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => handleAddFor(u.id)}>
                Add favorite for them
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleRemoveFor(u.id)}>
                Remove favorite for them
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/admin/chat/UserLookupTab.tsx
git commit -m "feat(chat): User Lookup tab with admin-override favorites controls"
```

---

## Task 10: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Build + dev**

```bash
pnpm build && pnpm dev
```

- [ ] **Step 2: Per-message admin actions via modal**

Sign in as admin. Open chat. Hover a message → `•••` menu. Verify all four items present: **Delete**, **Edit**, **Mute author**, **Ban author**. Click Mute. Modal opens. Fill out scope=Global, flavor=visible, reason="test". Confirm. The muted user sees "You can't post here." on their next post attempt.

- [ ] **Step 3: Edit-message snapshot in audit log**

Click Edit on a message. Change the body, fill out reason. Confirm. Re-query `chat_audit_log` for the most recent row of action='message_edit' — `metadata.previous_body` should be the original text.

- [ ] **Step 4: /admin/chat dashboard**

Navigate to `/admin/chat`. All four tabs render. Activity tab shows any flagged messages (post one with borderline language to populate). Bans tab lists active bans. Audit log tab paginates the last 100 rows; filters work. User Lookup tab searches by email/name and shows admin-override favorites buttons.

- [ ] **Step 5: Revoke a ban**

In the Bans tab, click Revoke on an active ban. Provide a reason. The ban row's `revoked_at` is set; the previously-banned user can now post.

- [ ] **Step 6: Manage anyone's favorites**

In User Lookup, search for a user. Click "Add favorite for them" → enter another user id → reason. The added edge appears in the target's favorites list (`favorites.list` for that user). Same flow for remove.

No commit for this task.

---

## Phase 5 done. Phase 6 preview

Phase 5 promotes moderation from "minimal" to "production-grade." Phase 6 closes out the original spec with:

- Tier 2 profanity (Claude Haiku 4.5 async escalation for borderline flagged messages, env-gated `CHAT_PROFANITY_TIER2=1`)
- Foreground toast for new messages on inactive chat tabs
- Tournament prize-pool surface in the chat header pinned banner
- Mobile UX polish (any nits surfaced in Phase 1-5 testing)
- 100-favorite cap UX polish (live counter, near-limit warning)
- The chat-store snapshot pattern reused for ad-hoc tests

Phase 5 is the last phase that introduces new admin power. Phase 6 is pure polish + the deferred Tier-2 filter.
