import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

// ─── Subscription Checkout ────────────────────────────────────────────────────

export async function createSubscriptionCheckout(
  userId: number,
  userEmail: string,
  tier: "player" | "pro" | "elite",
  origin: string
) {
  const prices: Record<string, string> = {
    player: process.env.STRIPE_PRICE_PLAYER || "price_player",
    pro: process.env.STRIPE_PRICE_PRO || "price_pro",
    elite: process.env.STRIPE_PRICE_ELITE || "price_elite",
  };

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",
    customer_email: userEmail,
    line_items: [
      {
        price: prices[tier],
        quantity: 1,
      },
    ],
    success_url: `${origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard`,
    metadata: {
      userId: userId.toString(),
      tier,
      type: "subscription",
    },
    client_reference_id: userId.toString(),
    allow_promotion_codes: true,
  });

  return session;
}

// ─── Entry Fee Checkout ──────────────────────────────────────────────────────

export async function createEntryFeeCheckout(
  userId: number,
  userEmail: string,
  entryFeeGameId: number,
  entryFeeAmount: number,
  gameType: "solo" | "team3" | "team5" | "team7",
  origin: string
) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: userEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${gameType.toUpperCase()} Game Entry`,
            description: `Entry fee for LyricPro ${gameType} game`,
          },
          unit_amount: Math.round(entryFeeAmount * 100), // Convert to cents
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/play/${entryFeeGameId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/setup`,
    metadata: {
      userId: userId.toString(),
      entryFeeGameId: entryFeeGameId.toString(),
      entryFeeAmount: entryFeeAmount.toString(),
      gameType,
      type: "entry_fee",
    },
    client_reference_id: userId.toString(),
  });

  return session;
}

// ─── Add-On Games Checkout ───────────────────────────────────────────────────

export async function createAddOnGamesCheckout(
  userId: number,
  userEmail: string,
  quantity: number,
  origin: string
) {
  const pricePerGame = 0.99;
  const totalAmount = quantity * pricePerGame;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: userEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "Additional Game Plays",
            description: `${quantity} additional game(s) at $${pricePerGame} each`,
          },
          unit_amount: Math.round(pricePerGame * 100),
        },
        quantity,
      },
    ],
    success_url: `${origin}/dashboard?addon_success=true`,
    cancel_url: `${origin}/dashboard`,
    metadata: {
      userId: userId.toString(),
      quantity: quantity.toString(),
      type: "add_on_games",
    },
    client_reference_id: userId.toString(),
  });

  return session;
}

// ─── Webhook Event Handlers ──────────────────────────────────────────────────

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
) {
  const userId = parseInt(session.client_reference_id || "0");
  const metadata = session.metadata || {};

  if (metadata.type === "subscription") {
    return {
      type: "subscription",
      userId,
      tier: metadata.tier,
      stripeSubscriptionId: session.subscription,
    };
  }

  if (metadata.type === "entry_fee") {
    return {
      type: "entry_fee",
      userId,
      entryFeeGameId: parseInt(metadata.entryFeeGameId || "0"),
      entryFeeAmount: parseFloat(metadata.entryFeeAmount || "0"),
      gameType: metadata.gameType,
    };
  }

  if (metadata.type === "add_on_games") {
    return {
      type: "add_on_games",
      userId,
      quantity: parseInt(metadata.quantity || "0"),
    };
  }

  return null;
}

export async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Handle subscription renewal payments
  const subscriptionId = typeof (invoice as any).subscription === 'string' 
    ? (invoice as any).subscription 
    : (invoice as any).subscription?.id;
  
  return {
    type: "invoice_paid",
    subscriptionId,
    amount: invoice.amount_paid,
  };
}

export async function handleCustomerSubscriptionDeleted(
  subscription: Stripe.Subscription
) {
  // Handle subscription cancellations
  return {
    type: "subscription_canceled",
    subscriptionId: subscription.id,
  };
}

// ─── Payout via Stripe Connect ───────────────────────────────────────────────

export async function createConnectAccount(
  userId: number,
  email: string,
  firstName: string,
  lastName: string
) {
  const account = await stripe.accounts.create({
    type: "express",
    email,
    individual: {
      first_name: firstName,
      last_name: lastName || "",
    },
    metadata: {
      userId: userId.toString(),
    },
  });

  return account;
}

export async function createAccountLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
) {
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: refreshUrl,
    return_url: returnUrl,
  });

  return link;
}

export async function createPayout(
  accountId: string,
  amount: number,
  description: string
) {
  const payout = await stripe.payouts.create(
    {
      amount: Math.round(amount * 100), // Convert to cents
      currency: "usd",
      description,
    },
    {
      stripeAccount: accountId,
    }
  );

  return payout;
}

// ─── Retrieve Session ────────────────────────────────────────────────────────

export async function getCheckoutSession(sessionId: string) {
  return await stripe.checkout.sessions.retrieve(sessionId);
}

// ─── Construct Webhook Event ────────────────────────────────────────────────

export function constructWebhookEvent(
  body: string | Buffer,
  signature: string,
  secret: string
) {
  return stripe.webhooks.constructEvent(body, signature, secret);
}
