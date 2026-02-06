// ~/everpay-backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import bodyParser from "body-parser";

import avatarRoutes from "./routes/avatar.js";
import stripeConnectRoutes from "./routes/stripeConnect.js";

import db, {
  storePayment,
  getPayments,
  getPaymentsByCreator
} from "./database.js";

import authRoutes from "./routes/auth.js";
import creatorProfileRoutes from "./routes/creatorProfile.js";
import creatorRoutes from "./routes/creator.js";

dotenv.config();

const app = express();

/* ================================
   ENV VALIDATION
================================ */
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  FRONTEND_URL,
  PORT
} = process.env;

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.error("❌ Missing Stripe environment variables");
  process.exit(1);
}

/* ================================
   STRIPE
================================ */
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

/* ================================
   MIDDLEWARE
================================ */
app.use(cors({ origin: "*" }));

/* ================================
   STRIPE WEBHOOK (RAW BODY ONLY)
================================ */
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      storePayment({
        id: session.id,
        amount: session.amount_total,
        email: session.customer_email,
        creator: session.metadata?.creator || null,
        status: session.payment_status,
        created_at: new Date().toISOString(),
        gift_name: session.metadata?.gift_name || null,
        anonymous: session.metadata?.anonymous === "true" ? 1 : 0,
        gift_message: session.metadata?.gift_message || null,
      });
    }

    res.json({ received: true });
  }
);

/* ================================
   JSON FOR EVERYTHING ELSE
================================ */
app.use(express.json());

/* ================================
   ROUTES
================================ */
app.use("/api/auth", authRoutes);
app.use("/api/creator", creatorProfileRoutes);
app.use("/api/creator", avatarRoutes);
app.use("/creator", creatorRoutes);

// Stripe Connect
app.use("/api/stripe", stripeConnectRoutes);

/* ================================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "EverPay Backend",
    environment: process.env.RENDER ? "production" : "local",
    time: new Date().toISOString(),
  });
});

/* ================================
   PAYMENTS API (FULL FIX)
================================ */

// Main EverPay dashboard
app.get("/api/payments", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const rows = await getPayments(limit);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ /api/payments error:", err);
    res.status(500).json({ error: "Failed to load payments" });
  }
});

// ✅ Creator payments (new route used by frontend)
app.get("/api/payments/creator/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const rows = await getPaymentsByCreator(username);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ /api/payments/creator/:username error:", err);
    res.status(500).json({ error: "Failed to load creator payments" });
  }
});

// ✅ Legacy support (won’t break old calls)
app.get("/api/payments/:creator", async (req, res) => {
  try {
    const { creator } = req.params;
    const rows = await getPaymentsByCreator(creator);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ /api/payments/:creator error:", err);
    res.status(500).json({ error: "Failed to load creator payments" });
  }
});

/* ================================
   DEPRECATED CARD ROUTE
================================ */
app.get("/pay", (req, res) => {
  return res.status(410).json({
    error: "Deprecated. Use POST /creator/pay/:username",
  });
});

/* ================================
   START SERVER
================================ */
const PORT_TO_USE = PORT || 5000;

app.listen(PORT_TO_USE, () => {
  console.log(`✅ EverPay Backend running on port ${PORT_TO_USE}`);
  console.log("📡 Webhook endpoint: POST /webhook");
  console.log("👤 Creator profile: /api/creator/profile");
  console.log("🎁 Creator pay: POST /creator/pay/:username");
});
