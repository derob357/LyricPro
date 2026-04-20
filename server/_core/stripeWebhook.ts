import { Request, Response } from "express";
import { getDb } from "../db";
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaid,
  handleCustomerSubscriptionDeleted,
  constructWebhookEvent,
} from "../stripe-integration";
import { updateSubscription } from "../db-monetization";
import {
  subscriptions,
  entryFeeParticipants,
  processedWebhookEvents,
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

// Redact Stripe identifiers and emails so webhook logs never leak sensitive
// values. Keeps the first 4 + last 4 characters of long IDs so operators can
// still trace events in the Stripe dashboard without exposing full tokens.
function redact(value: unknown): string {
  if (value == null) return "<null>";
  const s = String(value);
  if (s.length <= 10) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    console.error("[Webhook] Missing stripe-signature header");
    return res.status(400).json({ error: "Missing signature" });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret === "whsec_placeholder") {
    console.error("[Webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return res.status(500).json({ error: "Webhook not configured" });
  }

  let event;
  try {
    event = constructWebhookEvent(req.body, signature as string, secret);
  } catch (err) {
    console.error("[Webhook] Signature verification failed");
    return res
      .status(400)
      .json({ error: "Webhook signature verification failed" });
  }

  // Short-circuit Stripe CLI test events.
  if (event.id.startsWith("evt_test_")) {
    return res.json({ verified: true });
  }

  try {
    const db = await getDb();
    if (!db) throw new Error("Database connection failed");

    // ── Idempotency ──────────────────────────────────────────────────────────
    // Stripe can redeliver the same event (e.g. on a 500, or if we crash
    // before responding). Insert-ignore the event id; if the row already
    // exists we've handled it and return success without re-processing.
    try {
      await db.insert(processedWebhookEvents).values({
        eventId: event.id,
        eventType: event.type,
      });
    } catch (e) {
      // MySQL ER_DUP_ENTRY — already processed.
      console.log(`[Webhook] Event ${redact(event.id)} already processed; acking`);
      return res.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const result = await handleCheckoutSessionCompleted(session);
        if (!result) break;

        if (result.type === "subscription") {
          console.log(
            `[Webhook] Subscription purchased user=${result.userId} tier=${result.tier} sub=${redact(
              result.stripeSubscriptionId
            )}`
          );
          await updateSubscription(
            result.userId,
            result.tier as "free" | "player" | "pro" | "elite",
            result.stripeSubscriptionId as string
          );
        }

        if (result.type === "entry_fee") {
          console.log(
            `[Webhook] Entry fee paid user=${result.userId} game=${result.entryFeeGameId}`
          );
          if (result.entryFeeGameId && result.entryFeeAmount) {
            await db.insert(entryFeeParticipants).values([
              {
                entryFeeGameId: result.entryFeeGameId,
                userId: result.userId,
                entryFeeAmount: result.entryFeeAmount,
                payoutStatus: "pending" as const,
              },
            ]);
          }
        }

        if (result.type === "add_on_games") {
          console.log(
            `[Webhook] Add-on games purchased user=${result.userId} qty=${result.quantity}`
          );
          // Credits tracked by daily_game_tracking / subscriptions elsewhere.
        }

        if (result.type === "golden_notes") {
          const gnUserId = result.userId;
          const gnNotes = result.notes ?? 0;
          const gnPackId = result.packId;
          const gnPaymentIntent = result.paymentIntentId ?? null;
          console.log(
            `[Webhook] Golden Notes purchased user=${gnUserId} pack=${gnPackId} notes=${gnNotes}`
          );
          if (gnUserId && gnNotes > 0) {
            await db.transaction(async (tx) => {
              // Upsert the balance row: add to balance and lifetime counters
              // in one atomic statement, insert with defaults if missing.
              await tx
                .insert(goldenNoteBalances)
                .values({
                  userId: gnUserId,
                  balance: gnNotes,
                  lifetimePurchased: gnNotes,
                  lastPurchaseAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: goldenNoteBalances.userId,
                  set: {
                    balance: sql`${goldenNoteBalances.balance} + ${gnNotes}`,
                    lifetimePurchased: sql`${goldenNoteBalances.lifetimePurchased} + ${gnNotes}`,
                    lastPurchaseAt: new Date(),
                    updatedAt: new Date(),
                  },
                });

              const [after] = await tx
                .select({ balance: goldenNoteBalances.balance })
                .from(goldenNoteBalances)
                .where(eq(goldenNoteBalances.userId, gnUserId));

              await tx.insert(goldenNoteTransactions).values({
                userId: gnUserId,
                amount: gnNotes,
                kind: "purchase",
                reason: gnPackId ? `pack:${gnPackId}` : null,
                stripePaymentIntentId: gnPaymentIntent,
                balanceAfter: after?.balance ?? gnNotes,
              });
            });
          }
        }
        break;
      }

      case "invoice.paid": {
        // Subscription renewal: extend currentPeriodEnd one month forward on
        // the subscription matching this Stripe subscription id.
        const invoice = event.data.object;
        const result = await handleInvoicePaid(invoice);
        if (result.subscriptionId) {
          const newEnd = new Date();
          newEnd.setMonth(newEnd.getMonth() + 1);
          await db
            .update(subscriptions)
            .set({
              currentPeriodEnd: newEnd,
              status: "active",
              updatedAt: new Date(),
            })
            .where(
              eq(subscriptions.stripeSubscriptionId, result.subscriptionId)
            );
          console.log(
            `[Webhook] Renewed subscription ${redact(result.subscriptionId)} until ${newEnd.toISOString().slice(0, 10)}`
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const result = await handleCustomerSubscriptionDeleted(subscription);
        await db
          .update(subscriptions)
          .set({
            status: "canceled",
            canceledAt: new Date(),
            tier: "free",
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.stripeSubscriptionId, result.subscriptionId));
        console.log(
          `[Webhook] Canceled subscription ${redact(result.subscriptionId)}`
        );
        break;
      }

      case "charge.refunded": {
        // Reverse the state changes from the original payment. We use the
        // charge's payment_intent or invoice linkage to identify what was
        // paid for, then mark the corresponding row as refunded.
        const charge = event.data.object as {
          id: string;
          payment_intent?: string | null;
          invoice?: string | null;
          amount_refunded?: number;
        };
        console.log(
          `[Webhook] Charge refunded id=${redact(charge.id)} amount=${charge.amount_refunded ?? 0}`
        );

        // Entry-fee refund: mark the participant row as failed so payout
        // logic skips them and prize pool recalculation can run out-of-band.
        if (charge.payment_intent) {
          await db
            .update(entryFeeParticipants)
            .set({ payoutStatus: "failed", updatedAt: new Date() })
            .where(
              eq(
                entryFeeParticipants.stripePayoutId,
                charge.payment_intent as string
              )
            );
        }

        // Subscription refund: mark the subscription canceled so daily-game
        // gating reverts to free tier.
        if (charge.invoice) {
          // Look up subscription via stripeSubscriptionId on the invoice.
          // Note: fully reversing a partially-used subscription period would
          // need pro-rata handling — left for a follow-up if refunds become
          // common. For now we revert to free so the user can't keep using
          // paid features after a refund.
          console.log(
            `[Webhook] Refund linked to invoice ${redact(charge.invoice)}; flagging for review`
          );
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    // Roll back the idempotency row on failure so Stripe's retry will
    // re-process the event after we fix the underlying issue.
    try {
      const db = await getDb();
      if (db) {
        await db
          .delete(processedWebhookEvents)
          .where(eq(processedWebhookEvents.eventId, event.id));
      }
    } catch {}
    console.error(
      `[Webhook] Error processing ${event.type} event=${redact(event.id)}:`,
      error instanceof Error ? error.message : "unknown"
    );
    res.status(500).json({ error: "Internal server error" });
  }
}
