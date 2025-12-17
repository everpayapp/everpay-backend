import express from "express";
import Stripe from "stripe";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

router.post("/pay/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { amount, supporterName, anonymous, gift_message, isUK } = req.body;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const payment_method_types = isUK ? ["pay_by_bank"] : ["card"];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types,

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Gift for @${username}`,
            },
            unit_amount: Number(amount),
          },
          quantity: 1,
        },
      ],

      success_url: `${FRONTEND_URL}/creator/${username}?success=true`,
      cancel_url: `${FRONTEND_URL}/creator/${username}?cancel=true`,

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

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Creator payment session error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
