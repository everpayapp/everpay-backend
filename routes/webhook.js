import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import { storePayment } from "../database.js";

dotenv.config();
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe requires raw body
router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;

    try {
      const signature = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature failed", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const amount = session.amount_total;
      const email = session.customer_details?.email ?? null;
      const timestamp = new Date().toISOString();

      // Creator username
      const creator =
        session.metadata?.creator ||
        session.payment_intent?.metadata?.creator ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.creator ||
        "";

      // Supporter name
      const gift_name =
        session.metadata?.gift_name ||
        session.payment_intent?.metadata?.gift_name ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.gift_name ||
        "";

      // Supporter message
      const gift_message =
        session.metadata?.gift_message ||
        session.payment_intent?.metadata?.gift_message ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.gift_message ||
        "";

      // Anonymous flag
      const anonymous_str =
        session.metadata?.anonymous ||
        session.payment_intent?.metadata?.anonymous ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.anonymous ||
        "false";

      const anonymous = anonymous_str === "true";

      try {
        await storePayment({
          id: session.id,
          amount,
          email,
          creator,
          gift_name,
          gift_message,
          anonymous: anonymous ? 1 : 0,   // ← SQLite fix
          status: session.payment_status || "succeeded",
          created_at: timestamp,
        });

        console.log(
          `💾 Payment recorded → £${amount / 100} (creator: ${creator} | name: ${gift_name} | anonymous: ${anonymous})`
        );
      } catch (err) {
        console.error("❌ Failed to store payment:", err);
      }
    }

    res.status(200).json({ received: true });
  }
);

export default router;
