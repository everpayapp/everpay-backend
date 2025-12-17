import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Create Pay-by-Bank Session
router.get("/pay", async (req, res) => {
  try {
    const { amount: rawAmount, flexible, creator } = req.query;
    const parsedAmount = rawAmount ? parseFloat(String(rawAmount)) : NaN;

    // We expect `amount` to already be IN PENCE from the frontend.
    if (!flexible && (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0)) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const amountInPence = Math.round(parsedAmount); // e.g. 1000 = £10.00
    const idempotencyKey = req.headers["x-idempotency-key"];

    // 🔥 CREATOR payment mode (/creator/[username] tip page)
    if (creator) {
      const creatorName = String(creator);

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["pay_by_bank"],
          payment_method_options: { pay_by_bank: {} },

          line_items: [
            {
              price_data: {
                currency: "gbp",
                product_data: { name: `Tip for creator: ${creatorName}` },
                unit_amount: amountInPence,
              },
              quantity: 1,
            },
          ],

          // ✅ store creator on the session
          metadata: {
            source: "creator_page",
            creator: creatorName,
          },

          // ✅ and also on the payment_intent (extra safety)
          payment_intent_data: {
            metadata: {
              source: "creator_page",
              creator: creatorName,
            },
          },

          success_url: `${process.env.FRONTEND_URL}/creator/${creatorName}?success=true`,
          cancel_url: `${process.env.FRONTEND_URL}/creator/${creatorName}?canceled=true`,
        },
        idempotencyKey ? { idempotencyKey } : undefined
      );

      return res.json({ url: session.url });
    }

    // 💳 BUSINESS dashboard payments (main EverPay dashboard)
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: "lee@everpayapp.co.uk",
        payment_method_types: ["pay_by_bank"],
        payment_method_options: { pay_by_bank: {} },

        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: { name: "EverPay Instant Bank Payment" },
              unit_amount: amountInPence,
            },
            quantity: 1,
          },
        ],

        metadata: { source: "business" },
        payment_intent_data: {
          metadata: { source: "business" },
        },

        success_url: `${process.env.FRONTEND_URL}/?success=true`,
        cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
      },
      idempotencyKey ? { idempotencyKey } : undefined
    );

    res.json({ url: session.url });
  } catch (err) {
    console.error("💥 Error creating pay-by-bank session:", err);
    res.status(500).json({ error: "Pay by bank session failed" });
  }
});

export default router;
