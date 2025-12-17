// -----------------------------------------
// 💳 EverPay Smart NFC / Payment Link Route
// -----------------------------------------
import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// GET /link?amount=2500 (in pence)
router.get("/", async (req, res) => {
  try {
    const amount = parseInt(req.query.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Read optional idempotency key
    const idempotencyKey = req.headers["x-idempotency-key"];

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["pay_by_bank"],

        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: { name: "EverPay Instant Bank Payment" },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],

        // 🔥 Clean metadata for analytics + webhook tracking
        metadata: {
          source: "dashboard-link",
          amount: amount,
        },

        // Let Stripe collect the user's email
        customer_email: undefined,

        success_url: `${process.env.FRONTEND_URL}/?success=true`,
        cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
      },
      idempotencyKey ? { idempotencyKey } : undefined
    );

    // keep original behaviour
    return res.redirect(session.url);
  } catch (err) {
    console.error("❌ Error creating payment link:", err);
    res.status(500).json({ error: "Failed to create link" });
  }
});

export default router;
