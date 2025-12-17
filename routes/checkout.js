import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// -----------------------------------------
// 💳 EverPay: Card Checkout (Optional Backup)
// -----------------------------------------
router.get("/checkout", async (req, res) => {
  try {
    const amount = parseFloat(req.query.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const amountInPence = Math.round(amount * 100);

    // Optional idempotency key for double-click protection
    const idempotencyKey = req.headers["x-idempotency-key"];

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],

        invoice_creation: { enabled: true },

        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: { name: "EverPay Card Payment" },
              unit_amount: amountInPence,
            },
            quantity: 1,
          },
        ],

        // 🔥 Add clean metadata for webhook + analytics
        metadata: {
          source: "dashboard-card",
        },

        success_url: `${process.env.FRONTEND_URL}/?success=true`,
        cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
      },
      idempotencyKey ? { idempotencyKey } : undefined
    );

    return res.json({ url: session.url });
  } catch (err) {
    console.error("💥 Error creating Checkout session:", err);
    res.status(500).json({ error: "Card payment failed" });
  }
});

export default router;
