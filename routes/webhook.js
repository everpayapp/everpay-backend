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

      const meta = session.metadata || {};

      // Stripe reports TOTAL paid in amount_total (gift + EverPay fee)
      const stripeTotal =
        typeof session.amount_total === "number" ? session.amount_total : 0;

      // ✅ Prefer metadata breakdown first
      const gift_amount = meta.gift_amount ? parseInt(meta.gift_amount, 10) : null;
      const fee_amount = meta.fee_amount ? parseInt(meta.fee_amount, 10) : null;
      const total_paid = meta.total_paid ? parseInt(meta.total_paid, 10) : null;

      // ✅ Fallback: derive gift + fee from total when metadata is missing
      function deriveGiftBreakdownFromTotal(totalPence) {
        const total = Number(totalPence) || 0;

        if (!total || total <= 0) {
          return { gift: 0, fee: 0, total: 0 };
        }

        // EverPay fee = round(gift * 0.025)
        // Find the gift amount that produces this exact total
        for (let gift = total; gift >= Math.max(0, total - 100); gift--) {
          const fee = Math.round(gift * 0.025);
          if (gift + fee === total) {
            return { gift, fee, total };
          }
        }

        // Final fallback
        return { gift: total, fee: 0, total };
      }

      const derived = deriveGiftBreakdownFromTotal(stripeTotal);

      const gift = Number.isInteger(gift_amount) ? gift_amount : derived.gift;
      const fee = Number.isInteger(fee_amount) ? fee_amount : derived.fee;
      const total = Number.isInteger(total_paid) ? total_paid : derived.total;

      const email = session.customer_details?.email ?? null;
      const timestamp = new Date().toISOString();

      // Creator username
      const creator =
        meta.creator ||
        session.payment_intent?.metadata?.creator ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.creator ||
        "";

      // Supporter name
      const gift_name =
        meta.gift_name ||
        session.payment_intent?.metadata?.gift_name ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.gift_name ||
        "";

      // Supporter message
      const gift_message =
        meta.gift_message ||
        session.payment_intent?.metadata?.gift_message ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.gift_message ||
        "";

      // Anonymous flag
      const anonymous_str =
        meta.anonymous ||
        session.payment_intent?.metadata?.anonymous ||
        session.payment_intent?.charges?.data?.[0]?.metadata?.anonymous ||
        "false";

      const anonymous = anonymous_str === "true";

      try {
        await storePayment({
          id: session.id,

          // ✅ Legacy + creator-facing amount = GIFT ONLY
          amount: gift,

          // ✅ New breakdown fields
          gift_amount: gift,
          fee_amount: fee,
          total_paid: total,

          email,
          creator,
          gift_name,
          gift_message,
          anonymous: anonymous ? 1 : 0,
          status: session.payment_status || "succeeded",
          created_at: timestamp,
        });

        console.log(
          `💾 Payment recorded → gift £${gift / 100} (fee £${fee / 100}, total £${total / 100}) (creator: ${creator} | name: ${gift_name} | anonymous: ${anonymous})`
        );
      } catch (err) {
        console.error("❌ Failed to store payment:", err);
      }
    }

    res.status(200).json({ received: true });
  }
);

export default router;
