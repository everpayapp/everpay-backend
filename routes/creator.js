import express from "express";
import Stripe from "stripe";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

router.post("/pay/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { amount, supporterName, anonymous, gift_message, isUK } = req.body;

    const amountInt = Number(amount);

    // amount is in pence in your frontend
    if (!Number.isFinite(amountInt) || amountInt < 50) {
      return res.status(400).json({ error: "Invalid amount (min 50p)" });
    }

    // IMPORTANT:
    // If Pay by Bank is enabled + eligible, Stripe will show it.
    // Keeping card as well means you always have a fallback.
    const payment_method_types = ["pay_by_bank"];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types,

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

      metadata: {
        creator: username,
        gift_name: supporterName || "",
        gift_message: gift_message || "",
        anonymous: anonymous ? "true" : "false",
        source: "creator",
      },

      payment_intent_data: {
        metadata: {
          creator: username,
          gift_name: supporterName || "",
          gift_message: gift_message || "",
          anonymous: anonymous ? "true" : "false",
          source: "creator",
        },
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Creator payment session error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
