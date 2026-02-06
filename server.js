// ~/everpay-backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import bodyParser from "body-parser";
import avatarRoutes from "./routes/avatar.js";

// ✅ Stripe Connect routes
import stripeConnectRoutes from "./routes/stripeConnect.js";

// DB
import { storePayment, getPayments, getPaymentsByCreator } from "./database.js";

// ROUTES
import authRoutes from "./routes/auth.js";
import creatorProfileRoutes from "./routes/creatorProfile.js";
import creatorRoutes from "./routes/creator.js";

dotenv.config();

const app = express();

/* ================================
   ENV VALIDATION
================================ */
const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FRONTEND_URL, PORT } = process.env;

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
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        await storePayment({
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
      } catch (e) {
        console.error("❌ storePayment failed:", e);
      }
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

// ✅ Connect endpoints
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
   PAYMENTS API
================================ */
app.get("/api/payments", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const rows = await getPayments(limit);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ /api/payments error:", err);
    res.status(500).json({ error: "Failed to load payments" });
  }
});

// helper: make safe decode
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// helper: dedupe by id
function dedupeById(list) {
  const map = new Map();
  for (const item of list) map.set(item.id, item);
  return Array.from(map.values());
}

// ✅ NEW: canonical creator payments route your frontend expects
app.get("/api/payments/creator/:username", async (req, res) => {
  try {
    const usernameRaw = String(req.params.username || "");
    const decoded = safeDecode(usernameRaw);
    const encoded = encodeURIComponent(decoded);

    // try multiple possibilities (because older rows were stored encoded)
    const candidates = Array.from(
      new Set(
        [decoded, encoded, usernameRaw, safeDecode(decoded)]
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      )
    );

    let all = [];
    for (const c of candidates) {
      const rows = await getPaymentsByCreator(c);
      if (Array.isArray(rows) && rows.length) all = all.concat(rows);
    }

    const merged = dedupeById(all).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    res.json(merged || []);
  } catch (err) {
    console.error("❌ /api/payments/creator/:username error:", err);
    res.status(500).json({ error: "Failed to load creator payments" });
  }
});

// ✅ Keep the older route too (gift page currently uses /api/payments/:creator)
app.get("/api/payments/:creator", async (req, res) => {
  try {
    const creatorRaw = String(req.params.creator || "");
    const decoded = safeDecode(creatorRaw);
    const encoded = encodeURIComponent(decoded);

    const candidates = Array.from(
      new Set(
        [decoded, encoded, creatorRaw, safeDecode(decoded)]
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      )
    );

    let all = [];
    for (const c of candidates) {
      const rows = await getPaymentsByCreator(c);
      if (Array.isArray(rows) && rows.length) all = all.concat(rows);
    }

    const merged = dedupeById(all).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    res.json(merged || []);
  } catch (err) {
    console.error("❌ /api/payments/:creator error:", err);
    res.status(500).json({ error: "Failed to load creator payments" });
  }
});

/* ================================
   DEPRECATED CARD ROUTE (DISABLED)
================================ */
app.get("/pay", (req, res) => {
  return res.status(410).json({
    error: "Deprecated. Use POST /creator/pay/:username",
    example: "POST /creator/pay/lee  { amount: 500, supporterName: 'Test', ... }",
  });
});

/* ================================
   START SERVER
================================ */
const PORT_TO_USE = PORT || 5000;

app.listen(PORT_TO_USE, () => {
  console.log(`✅ EverPay Backend running on port ${PORT_TO_USE}`);
  console.log("📡 Webhook endpoint: POST /webhook");
  console.log("🔐 Auth endpoints: /api/auth/login | /api/auth/signup");
  console.log("👤 Creator profile: /api/creator/profile");
  console.log("🎁 Creator pay: POST /creator/pay/:username");
});

