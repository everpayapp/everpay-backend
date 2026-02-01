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

async function getStripeAccountId(username) {
  const db = await dbPromise;
  // If the column doesn't exist yet, this will throw — but we added it safely in stripeConnect.js.
  const row = await db.get(
    "SELECT stripe_account_id FROM creators WHERE username = ?",
    username
  );
  return row?.stripe_account_id || null;
}

router.post("/pay/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { amount, supporterName, anonymous, gift_message } = req.body;

    const amountInt = Number(amount);

    // amount is in pence
    if (!Number.isFinite(amountInt) || amountInt < 50) {
      return res.status(400).json({ error: "Invalid amount (min 50p)" });
    }

    // ✅ Bank-only for creator gifts
    const payment_method_types = ["pay_by_bank"];

    // ✅ If creator connected, send money to their connected Stripe account
    const stripeAccountId = await getStripeAccountId(username);

    const paymentIntentData = {
      metadata: {
        creator: username,
        gift_name: supporterName || "",
        gift_message: gift_message || "",
        anonymous: anonymous ? "true" : "false",
        source: stripeAccountId ? "creator-pay-to-connect" : "creator-pay-to-platform",
      },
      ...(stripeAccountId
        ? {
            transfer_data: { destination: stripeAccountId },
          }
        : {}),
    };

    const session = await stripe.checkout.sessions.create({
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

      success_url: `${FRONTEND_URL}/creator/${encodeURIComponent(username)}?success=true`,
      cancel_url: `${FRONTEND_URL}/creator/${encodeURIComponent(username)}?cancel=true`,

      metadata: {
        creator: username,
        gift_name: supporterName || "",
        gift_message: gift_message || "",
        anonymous: anonymous ? "true" : "false",
        source: stripeAccountId ? "creator-pay-to-connect" : "creator-pay-to-platform",
      },

      payment_intent_data: paymentIntentData,
    });

    // Safety check: ensure pay_by_bank remained the payment method
    if (
      !Array.isArray(session.payment_method_types) ||
      session.payment_method_types[0] !== "pay_by_bank"
    ) {
      console.error("❌ Stripe did not keep pay_by_bank. Returned:", session.payment_method_types);
      return res.status(500).json({
        error: "Pay by Bank not available for this session (Stripe returned different payment methods).",
        returned_payment_method_types: session.payment_method_types,
      });
    }

    return res.json({ url: session.url, connected: !!stripeAccountId });
  } catch (err) {
    console.error("❌ Creator payment session error:", err);
    return res.status(500).json({
      error: "Internal server error",
      stripe_message: err?.message || undefined,
    });
  }
});

export default router;

