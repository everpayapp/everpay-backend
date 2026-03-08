// ~/everpay-backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import avatarRoutes from "./routes/avatar.js";

// ✅ Stripe Connect routes
import stripeConnectRoutes from "./routes/stripeConnect.js";

// DB
import { getPayments, getPaymentsByCreator } from "./database.js";

// ROUTES
import authRoutes from "./routes/auth.js";
import creatorProfileRoutes from "./routes/creatorProfile.js";
import creatorRoutes from "./routes/creator.js";
import prizePoolRoutes from "./routes/prizePool.js";
import topSupportersRoutes from "./routes/topSupporters.js";
import webhookRoutes from "./routes/webhook.js";

dotenv.config();

const app = express();

/* ================================
   HELPERS
================================ */
function safeDecode(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  try {
    if (/%[0-9A-Fa-f]{2}/.test(raw)) return decodeURIComponent(raw);
    return raw;
  } catch {
    return raw;
  }
}

function normalizeCreatorKey(input) {
  return safeDecode(input).trim();
}

/* ================================
   ENV VALIDATION
================================ */
const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PORT } = process.env;

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.error("❌ Missing Stripe environment variables");
  process.exit(1);
}

/* ================================
   MIDDLEWARE
================================ */
app.use(cors({ origin: "*" }));

/* ================================
   STRIPE WEBHOOK (RAW BODY ONLY)
   IMPORTANT: must come BEFORE express.json()
================================ */
app.use("/webhook", webhookRoutes);

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

// 🎁 Prize Pool (live monthly total)
app.use("/api/prize-pool", prizePoolRoutes);

// 🏆 Top Supporters (live monthly leaderboard)
app.use("/api/top-supporters", topSupportersRoutes);

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

app.get("/api/payments/:creator", async (req, res) => {
  try {
    const creator = normalizeCreatorKey(req.params.creator);
    const rows = await getPaymentsByCreator(creator);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ /api/payments/:creator error:", err);
    res.status(500).json({ error: "Failed to load creator payments" });
  }
});

app.get("/api/payments/creator/:username", async (req, res) => {
  try {
    const username = normalizeCreatorKey(req.params.username);
    const rows = await getPaymentsByCreator(username);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ /api/payments/creator/:username error:", err);
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
