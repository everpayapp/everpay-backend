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

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch {
        event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          process.env.STRIPE_CONNECTED_WEBHOOK_SECRET
        );
      }
    } catch (err) {
      console.error("❌ Webhook signature failed", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // =========================
    // CHECKOUT SESSION
    // =========================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const meta = session.metadata || {};

      const gift = parseInt(meta.gift_amount || 0, 10);
      const fee = parseInt(meta.fee_amount || 0, 10);
      const total = parseInt(meta.total_paid || 0, 10);

      const email = session.customer_details?.email ?? null;

      try {
        await storePayment({
          id: session.id,
          amount: gift,
          gift_amount: gift,
          fee_amount: fee,
          total_paid: total,
          stripe_fee_amount: 0,
          net_amount: 0,
          email,
          creator: meta.creator || "",
          gift_name: meta.gift_name || "",
          gift_message: meta.gift_message || "",
          anonymous: meta.anonymous === "true" ? 1 : 0,
          status: session.payment_status || "paid",
          created_at: new Date().toISOString(),
        });

        console.log("💾 Stored checkout session:", session.id);
      } catch (err) {
        console.error("❌ Checkout store error:", err);
      }
    }

    // =========================
    // PAYMENT INTENT (FIXED)
    // =========================
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const meta = pi.metadata || {};
      const connectedAccountId = event.account || null;

      console.log("🔎 DEBUG PI:", {
        id: pi.id,
        latest_charge: pi.latest_charge,
        account: connectedAccountId,
      });

      let stripeFeeAmount = 0;
      let netAmount = 0;

      try {
        if (connectedAccountId && pi.latest_charge) {
          const charge = await stripe.charges.retrieve(pi.latest_charge, {
            stripeAccount: connectedAccountId,
          });

          const balanceTx = await stripe.balanceTransactions.retrieve(
            charge.balance_transaction,
            {
              stripeAccount: connectedAccountId,
            }
          );

          stripeFeeAmount = balanceTx.fee || 0;
          netAmount = balanceTx.net || 0;
        }
      } catch (err) {
        console.error("❌ Fee fetch failed:", err.message);
      }

      try {
        await storePayment({
          id:
            pi.payment_details?.order_reference ||
            pi.id,
          amount: parseInt(meta.gift_amount || 0, 10),
          gift_amount: parseInt(meta.gift_amount || 0, 10),
          fee_amount: parseInt(meta.fee_amount || 0, 10),
          total_paid: parseInt(meta.total_paid || 0, 10),
          stripe_fee_amount: stripeFeeAmount,
          net_amount: netAmount,
          email: pi.receipt_email || null,
          creator: meta.creator || "",
          gift_name: meta.gift_name || "",
          gift_message: meta.gift_message || "",
          anonymous: meta.anonymous === "true" ? 1 : 0,
          status: "paid",
          created_at: new Date().toISOString(),
        });

        console.log("✅ UPDATED WITH FEES:", {
          fee: stripeFeeAmount,
          net: netAmount,
        });
      } catch (err) {
        console.error("❌ Update store error:", err);
      }
    }

    res.status(200).json({ received: true });
  }
);

export default router;
