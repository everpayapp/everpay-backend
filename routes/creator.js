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

// Turn "Roulla%20Antoniou" -> "Roulla Antoniou"
// Also handles "+" as space just in case.
function canonicalUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const plusFixed = raw.replace(/\+/g, " ");

  // Only decode if it actually looks encoded
  try {
    if (/%[0-9A-Fa-f]{2}/.test(plusFixed)) return decodeURIComponent(plusFixed).trim();
  } catch {
    // ignore decode failures, fallback to raw
  }

  return plusFixed.trim();
}

// ✅ Find creator by username OR profile_name (case-insensitive)
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

    // ✅ Always canonicalize (decode %20 etc)
    const username = canonicalUsername(rawUsername);

    const { amount, supporterName, anonymous, gift_message } = req.body;

    const amountInt = Number(amount);

    // amount is in pence
    if (!Number.isFinite(amountInt) || amountInt < 50) {
      return res.status(400).json({ error: "Invalid amount (min 50p)" });
    }

    // ✅ Supporter covers EverPay fee (2.5%) on top of the gift
    const giftAmount = Math.round(amountInt); // in pence
    const everpayFee = Math.round(giftAmount * 0.025);
    const totalCharge = giftAmount + everpayFee;

    // ✅ Get connected Stripe account
    const stripeAccountId = await getStripeAccountId(username);

    if (!stripeAccountId) {
      return res.status(400).json({
        error: "Creator has not connected Stripe yet",
      });
    }

    // ✅ metadata creator MUST be canonical (never %20)
    // ✅ include gift/fee/total so webhook can store correctly
    const meta = {
      creator: username,
      gift_name: supporterName || "",
      gift_message: gift_message || "",
      anonymous: anonymous ? "true" : "false",

      // breakdown (all in pence)
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
            unit_amount: totalCharge, // supporter pays gift + fee
          },
          quantity: 1,
        },
      ],

      // ✅ URL uses encoded form, but username itself stays canonical everywhere else
      success_url: `${FRONTEND_URL}/creator/${encodeURIComponent(username)}?success=true`,
      cancel_url: `${FRONTEND_URL}/creator/${encodeURIComponent(username)}?cancel=true`,

      metadata: meta,

      payment_intent_data: {
        metadata: meta,
        application_fee_amount: everpayFee,
      },
    };

    const session = await stripe.checkout.sessions.create(sessionParams, {
      stripeAccount: stripeAccountId,
    });

    return res.json({
      url: session.url,
      connected: true,
      stripe_account_id: stripeAccountId,
      creator: username,
      payment_method_types: session.payment_method_types || [],
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
