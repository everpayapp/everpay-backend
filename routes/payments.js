import express from "express";
import { getPayments, getPaymentsByCreator } from "../database.js";

const router = express.Router();

function toMillis(value) {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function paymentQuality(p) {
  const stripeFee = Number(p?.stripe_fee_amount || 0);
  const net = Number(p?.net_amount || 0);

  if (stripeFee > 0 || net > 0) return 2;
  return 1;
}

function sameLogicalGift(a, b) {
  const timeDiff = Math.abs(toMillis(a.created_at) - toMillis(b.created_at));

  return (
    (a.creator || "") === (b.creator || "") &&
    (a.email || "") === (b.email || "") &&
    (a.gift_name || "") === (b.gift_name || "") &&
    (a.gift_message || "") === (b.gift_message || "") &&
    Number(a.gift_amount || a.amount || 0) === Number(b.gift_amount || b.amount || 0) &&
    Number(a.fee_amount || 0) === Number(b.fee_amount || 0) &&
    Number(a.total_paid || 0) === Number(b.total_paid || 0) &&
    Number(a.anonymous || 0) === Number(b.anonymous || 0) &&
    timeDiff <= 30000
  );
}

function chooseBetterPayment(a, b) {
  const qa = paymentQuality(a);
  const qb = paymentQuality(b);

  if (qb > qa) return b;
  if (qa > qb) return a;

  return toMillis(b.created_at) > toMillis(a.created_at) ? b : a;
}

function dedupePayments(list) {
  const sorted = [...list].sort(
    (a, b) => toMillis(b.created_at) - toMillis(a.created_at)
  );

  const result = [];

  for (const payment of sorted) {
    const existingIndex = result.findIndex((item) => sameLogicalGift(item, payment));

    if (existingIndex === -1) {
      result.push(payment);
    } else {
      result[existingIndex] = chooseBetterPayment(result[existingIndex], payment);
    }
  }

  return result.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
}

// MAIN EverPay dashboard — all payments
router.get("/", async (req, res) => {
  try {
    const list = await getPayments();
    const businessOnly = list.filter((p) => !p.creator || p.creator === "");
    const deduped = dedupePayments(businessOnly);
    res.json(deduped);
  } catch (err) {
    console.error("❌ Error loading payments:", err);
    res.status(500).json({ error: "Failed to load payments" });
  }
});

// CREATOR public page — payments for a specific creator
router.get("/creator/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const payments = await getPaymentsByCreator(username);
    const deduped = dedupePayments(payments);
    res.json(deduped);
  } catch (error) {
    console.error("⚠️ Failed to get creator payments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
