// -----------------------------------------
// 🚀 EverPay Backend (Express + Stripe)
// -----------------------------------------
import express from "express";
import dotenv from "dotenv";

// Routes
import payRouter from "./routes/pay.js";
import webhookRouter from "./routes/webhook.js";
import paymentsRoute from "./routes/payments.js";
import checkoutRoute from "./routes/checkout.js";
import linkRoute from "./routes/link.js";
import creatorRouter from "./routes/creator.js";
import creatorProfileRoutes from "./routes/creatorProfile.js"; // ⭐ NEW

// ⭐ NEW — Auth routes (LOGIN + SIGNUP)
import authRoutes from "./routes/auth.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// -----------------------------------------
// 🔓 CORS (for development)
// -----------------------------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, stripe-signature"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// -----------------------------------------
// ⚠️ MUST be before JSON parser
// Stripe Webhook (raw body)
// -----------------------------------------
app.use("/webhook", webhookRouter);

// -----------------------------------------
// 🧩 Body Parsers (AFTER webhook only)
// -----------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -----------------------------------------
// 🔐 Auth Routes (⭐ new)
// -----------------------------------------
app.use("/auth", authRoutes);

// -----------------------------------------
// 💳 Payment Routes
// -----------------------------------------

// Dashboard pay-by-bank
app.use("/", payRouter);

// Optional card/other checkout route
app.use("/", checkoutRoute);

// Creator payments (gifts)
app.use("/creator", creatorRouter);

// Smart NFC / generated payment links
app.use("/link", linkRoute);

// -----------------------------------------
// 💾 Payment history API
// -----------------------------------------
app.use("/api/payments", paymentsRoute);

// -----------------------------------------
// 🧑‍🎤 Creator profile API (⭐ new)
// -----------------------------------------
app.use("/api/creator", creatorProfileRoutes);

// -----------------------------------------
// 🩺 Health Check
// -----------------------------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// -----------------------------------------
// ▶️ Start server
// -----------------------------------------
app.listen(PORT, () => {
  console.log("🧾 Environment validated.");
  console.log(`✅ EverPay Backend running at http://localhost:${PORT}`);
  console.log("ℹ️ Webhook endpoint: POST /webhook");
  console.log("ℹ️ Pay test:        GET  /pay?amount=199");
});

