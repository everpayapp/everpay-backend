// ~/everpay-backend/routes/creator.js
import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import dbPromise from "../database.js";

dotenv.config();

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/* ------------------ helpers ------------------ */

function norm(u) {
  return String(u || "").trim();
}

// ✅ Find creator by username OR profile_name (case-insensitive)
async function getStripeAccountId(usernameOrName) {
  const db = await dbPromise;
  const u = norm(usernameOrName);

  const row = await db.get(
    `
    SELECT stripe_account_id
    FROM creators
    WHERE LOWER(username) = LOWER(?)
       OR LOWER(profile_name) = LOWER(?)
    LIMIT 1
    `,
    u,
    u
  );

  return row?.stripe_account_id || null;
}

/* ------------------ routes ------------------ */

router.post("/pay/:username", async (req, res) => {
  try {
    const { username: rawUsername } = req.params;
    const username = norm(rawUsername);

    const { amount, supporterName, anonymous, gift_message } = req.body;

    const amountInt = Number(amount);

    // amount is in pence
    if (!Number.isFinite(amountInt) || amountInt < 50) {
      return res.status(400).json({ error: "Invalid amount (min 50p)" });
    }

    // ✅ Bank-only for creator gifts
    const payment_method_types = ["pay_by_bank"];

    // ✅ Get connected Stripe account
    const stripeAccountId = await getStripeAccountId(username);

    const meta = {
      creator: username,
      gift_name: supporterName || "",
      gift_message: gift_message || "",
      anonymous: anonymous ? "true" : "false",
      source: stripeAccountId
        ? "creator-direct-charge"
        : "creator-platform-charge",
    };

    const sessionParams = {
      mode: "payment",
      payment_method_types,

      client_reference_id: `creator:${username}`,

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: { name: `Gift for @${username}` },
            unit_amount: Math.round(amountInt),
          },
          quantity: 1,
        },
      ],

      success_url: `${FRONTEND_URL}/creator/${encodeURIComponent(
        username
      )}?success=true`,
      cancel_url: `${FRONTEND_URL}/creator/${encodeURIComponent(
        username
      )}?cancel=true`,

      metadata: meta,

      payment_intent_data: {
        metadata: meta,
      },
    };

// ✅ If creator connected → use DESTINATION CHARGE (platform Checkout + transfer to creator)
// This keeps Pay by Bank working while still sending funds to the connected account.
if (stripeAccountId) {
  sessionParams.payment_intent_data = sessionParams.payment_intent_data || {};
  sessionParams.payment_intent_data.transfer_data = {
    destination: stripeAccountId,
  };
}

const session = await stripe.checkout.sessions.create(sessionParams);

// Safety check
if (
  !Array.isArray(session.payment_method_types) ||
  session.payment_method_types[0] !== "pay_by_bank"
) {
  console.error("❌ Stripe changed payment methods:", session.payment_method_types);
  return res.status(500).json({
    error: "Pay by Bank not available",
    returned_payment_method_types: session.payment_method_types,
  });
}

    return res.json({
      url: session.url,
      connected: !!stripeAccountId,
      stripe_account_id: stripeAccountId || null,
    });
  } catch (err) {
    console.error("❌ Creator payment session error:", err);
    return res.status(500).json({
      error: "Internal server error",
      stripe_message: err?.message || undefined,
    });
  }
});

export default router;
