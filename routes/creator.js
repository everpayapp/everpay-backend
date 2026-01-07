import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types,

      // Helpful in Stripe dashboard/logs
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
        source: "creator-pay-by-bank-only",
      },

      payment_intent_data: {
        metadata: {
          creator: username,
          gift_name: supporterName || "",
          gift_message: gift_message || "",
          anonymous: anonymous ? "true" : "false",
          source: "creator-pay-by-bank-only",
        },
      },
    });

    // 🚨 Hard safety check: if Stripe ever returns anything but pay_by_bank, fail loudly
    if (!Array.isArray(session.payment_method_types) || session.payment_method_types[0] !== "pay_by_bank") {
      console.error("❌ Stripe did not keep pay_by_bank. Returned:", session.payment_method_types);
      return res.status(500).json({
        error: "Pay by Bank not available for this session (Stripe returned different payment methods).",
        returned_payment_method_types: session.payment_method_types,
      });
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Creator payment session error:", err);
    // return Stripe's message if available (helps debugging eligibility)
    return res.status(500).json({
      error: "Internal server error",
      stripe_message: err?.message || undefined,
    });
  }
});

export default router;

