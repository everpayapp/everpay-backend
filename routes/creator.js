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

function canonicalUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const plusFixed = raw.replace(/\+/g, " ");

  try {
    if (/%[0-9A-Fa-f]{2}/.test(plusFixed)) {
      return decodeURIComponent(plusFixed).trim();
    }
  } catch {}

  return plusFixed.trim();
}

async function getStripeAccountId(usernameOrName) {
  const db = await dbPromise;

  const decoded = canonicalUsername(usernameOrName);
  const encoded = encodeURIComponent(decoded);

  const row = await db.get(
    `
    SELECT stripe_account_id
    FROM creators
    WHERE LOWER(username) = LOWER(?)
       OR LOWER(username) = LOWER(?)
       OR LOWER(profile_name) = LOWER(?)
       OR LOWER(profile_name) = LOWER(?)
    LIMIT 1
    `,
    decoded,
    encoded,
    decoded,
    encoded
  );

  return row?.stripe_account_id || null;
}

/* ------------------ routes ------------------ */

router.post("/pay/:username", async (req, res) => {
  try {
    const { username: rawUsername } = req.params;
    const username = canonicalUsername(rawUsername);

    const { amount, supporterName, anonymous, gift_message } = req.body;

    const amountInt = Number(amount);

    if (!Number.isFinite(amountInt) || amountInt < 50) {
      return res.status(400).json({ error: "Invalid amount (min 50p)" });
    }

    // ✅ fee logic
    const giftAmount = Math.round(amountInt);
    const everpayFee = Math.round(giftAmount * 0.025);
    const totalCharge = giftAmount + everpayFee;

    // ✅ get connected account
    const stripeAccountId = await getStripeAccountId(username);

    if (!stripeAccountId) {
      return res.status(400).json({
        error: "Creator has not connected Stripe yet",
      });
    }

    // ✅ metadata (for webhook + DB)
    const meta = {
      creator: username,
      gift_name: supporterName || "",
      gift_message: gift_message || "",
      anonymous: anonymous ? "true" : "false",
      gift_amount: String(giftAmount),
      fee_amount: String(everpayFee),
      total_paid: String(totalCharge),
      source: "creator-direct-charge",
    };

    const sessionParams = {
      mode: "payment",

      client_reference_id: `creator:${username}`,

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: { name: `Gift for @${username}` },
            unit_amount: totalCharge,
          },
          quantity: 1,
        },
      ],

      success_url: `${FRONTEND_URL}/creator/${encodeURIComponent(username)}?success=true`,
      cancel_url: `${FRONTEND_URL}/creator/${encodeURIComponent(username)}?cancel=true`,

      metadata: meta,

      payment_intent_data: {
        metadata: meta,
        application_fee_amount: everpayFee,
      },
    };

    // ✅ DIRECT CHARGE (final setup)
    const session = await stripe.checkout.sessions.create(sessionParams, {
      stripeAccount: stripeAccountId,
    });

    // ✅ write the session id back into BOTH session + payment intent metadata
    const updatedMeta = {
      ...meta,
      checkout_session_id: session.id,
    };

    await stripe.checkout.sessions.update(
      session.id,
      {
        metadata: updatedMeta,
      },
      {
        stripeAccount: stripeAccountId,
      }
    );

    // Update the PaymentIntent metadata too, so webhook matching is reliable
    if (session.payment_intent) {
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id;

      await stripe.paymentIntents.update(
        paymentIntentId,
        {
          metadata: updatedMeta,
        },
        {
          stripeAccount: stripeAccountId,
        }
      );
    }

    return res.json({
      url: session.url,
      connected: true,
      stripe_account_id: stripeAccountId,
      creator: username,
    });
  } catch (err) {
    console.error("❌ Creator payment session error:", err);

    return res.status(500).json({
      error: "Internal server error",
      stripe_message:
        err?.raw?.message ||
        err?.message ||
        err?.raw?.code ||
        "Unknown Stripe error",
      stripe_code: err?.raw?.code || null,
      stripe_type: err?.type || null,
    });
  }
});

export default router;
