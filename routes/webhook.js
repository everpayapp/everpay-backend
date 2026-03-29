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
      } catch (err1) {
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

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const meta = session.metadata || {};

      const stripeTotal =
        typeof session.amount_total === "number" ? session.amount_total : 0;

      const rawGiftAmount = meta.gift_amount
        ? parseInt(meta.gift_amount, 10)
        : null;
      const rawFeeAmount = meta.fee_amount
        ? parseInt(meta.fee_amount, 10)
        : null;
      const rawTotalPaid = meta.total_paid
        ? parseInt(meta.total_paid, 10)
        : null;

      function deriveGiftBreakdownFromTotal(totalPence) {
        const total = Number(totalPence) || 0;

        if (!total || total <= 0) {
          return { gift: 0, fee: 0, total: 0 };
        }

        for (let gift = total; gift >= Math.max(0, total - 100); gift--) {
          const fee = Math.round(gift * 0.025);
          if (gift + fee === total) {
            return { gift, fee, total };
          }
        }

        return { gift: total, fee: 0, total };
      }

      const derived = deriveGiftBreakdownFromTotal(rawTotalPaid ?? stripeTotal);

      const metadataLooksValid =
        Number.isInteger(rawGiftAmount) &&
        Number.isInteger(rawFeeAmount) &&
        Number.isInteger(rawTotalPaid) &&
        rawGiftAmount + rawFeeAmount === rawTotalPaid &&
        rawTotalPaid > 0;

      const gift = metadataLooksValid ? rawGiftAmount : derived.gift;
      const fee = metadataLooksValid ? rawFeeAmount : derived.fee;
      const total = metadataLooksValid ? rawTotalPaid : derived.total;

      const email = session.customer_details?.email ?? null;
      const timestamp = new Date().toISOString();

      const creator = meta.creator || "";
      const gift_name = meta.gift_name || "";
      const gift_message = meta.gift_message || "";
      const anonymous = (meta.anonymous || "false") === "true";

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
          creator,
          gift_name,
          gift_message,
          anonymous: anonymous ? 1 : 0,
          status: session.payment_status || "paid",
          created_at: timestamp,
        });

        console.log(
          `💾 Checkout session stored → ${session.id} | gift £${gift / 100} (fee £${fee / 100}, total £${total / 100})`
        );
      } catch (err) {
        console.error("❌ Failed to store checkout session payment:", err);
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const meta = paymentIntent.metadata || {};
      const connectedAccountId = event.account || null;

      const creator = meta.creator || "";
      const gift_name = meta.gift_name || "";
      const gift_message = meta.gift_message || "";
      const anonymous = (meta.anonymous || "false") === "true";

      const rawGiftAmount = meta.gift_amount
        ? parseInt(meta.gift_amount, 10)
        : null;
      const rawFeeAmount = meta.fee_amount
        ? parseInt(meta.fee_amount, 10)
        : null;
      const rawTotalPaid = meta.total_paid
        ? parseInt(meta.total_paid, 10)
        : null;

      const gift =
        Number.isInteger(rawGiftAmount) && rawGiftAmount > 0
          ? rawGiftAmount
          : typeof paymentIntent.amount_received === "number"
            ? paymentIntent.amount_received
            : typeof paymentIntent.amount === "number"
              ? paymentIntent.amount
              : 0;

      const fee =
        Number.isInteger(rawFeeAmount) && rawFeeAmount >= 0 ? rawFeeAmount : 0;

      const total =
        Number.isInteger(rawTotalPaid) && rawTotalPaid > 0
          ? rawTotalPaid
          : typeof paymentIntent.amount === "number"
            ? paymentIntent.amount
            : gift + fee;

      const timestamp = new Date().toISOString();

      let stripeFeeAmount = 0;
      let netAmount = 0;

      // Your live event payload already showed this contains the Checkout Session id.
      let checkoutSessionId =
        paymentIntent.payment_details?.order_reference || null;

      let email = paymentIntent.receipt_email || null;

            try {
        if (connectedAccountId) {
          let charge = null;

          const chargeId =
            typeof paymentIntent.latest_charge === "string"
              ? paymentIntent.latest_charge
              : paymentIntent.latest_charge?.id || null;

          if (chargeId) {
            charge = await stripe.charges.retrieve(chargeId, {
              stripeAccount: connectedAccountId,
            });
          }

          if (charge) {
            if (!email) {
              email = charge.billing_details?.email || null;
            }

            const balanceTxId =
              typeof charge.balance_transaction === "string"
                ? charge.balance_transaction
                : charge.balance_transaction?.id || null;

            if (balanceTxId) {
              const balanceTx = await stripe.balanceTransactions.retrieve(
                balanceTxId,
                {
                  stripeAccount: connectedAccountId,
                }
              );

              stripeFeeAmount = balanceTx.fee || 0;
              netAmount = balanceTx.net || 0;
            }
          }
        }
      } catch (err) {
        console.error(
          "❌ Failed to enrich payment_intent.succeeded:",
          err.message || err
        );
      }

      try {
        await storePayment({
          id: checkoutSessionId || paymentIntent.id,
          amount: gift,
          gift_amount: gift,
          fee_amount: fee,
          total_paid: total,
          stripe_fee_amount: stripeFeeAmount,
          net_amount: netAmount,
          email,
          creator,
          gift_name,
          gift_message,
          anonymous: anonymous ? 1 : 0,
          status: "paid",
          created_at: timestamp,
        });

        console.log(
          `✅ Payment intent updated → ${checkoutSessionId || paymentIntent.id} | gift £${gift / 100} | stripe fee £${stripeFeeAmount / 100} | net £${netAmount / 100}`
        );
      } catch (err) {
        console.error("❌ Failed to store payment_intent update:", err);
      }
    }

    res.status(200).json({ received: true });
  }
);

export default router;
