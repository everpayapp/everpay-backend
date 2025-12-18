import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import bodyParser from "body-parser";
import { v4 as uuidv4 } from "uuid";

// DB
import db, {
  storePayment,
  getPayments,
  getPaymentsByCreator,
  getCreatorPayments,
  getCreatorByUsername,
} from "./database.js";

// ROUTES
import authRoutes from "./routes/auth.js";

dotenv.config();

const app = express();

/* ================================
   ENV VALIDATION
================================ */
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  FRONTEND_URL,
  PORT,
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
   AUTH ROUTES  ✅ (THIS WAS MISSING)
================================ */
app.use("/api/auth", authRoutes);

/* ================================
   ROOT (FIXES Cannot GET /)
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
   CREATE PAYMENT
================================ */
app.get("/pay", async (req, res) => {
  try {
    const amount = Number(req.query.amount);
    const creator = req.query.creator || "everpay";

    if (!amount || amount < 50) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: { name: "EverPay Gift" },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: { creator },
      success_url: `${FRONTEND_URL}/success`,
      cancel_url: `${FRONTEND_URL}/cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Payment failed" });
  }
});

/* ================================
   PAYMENTS API
================================ */
app.get("/api/payments", (req, res) => {
  const limit = Number(req.query.limit) || 10;
  res.json(getPayments(limit));
});

app.get("/api/payments/:creator", (req, res) => {
  const { creator } = req.params;
  res.json(getPaymentsByCreator(creator));
});

/* ================================
   START SERVER
================================ */
const PORT_TO_USE = PORT || 5000;

app.listen(PORT_TO_USE, () => {
  console.log(`✅ EverPay Backend running on port ${PORT_TO_USE}`);
  console.log("📡 Webhook endpoint: POST /webhook");
  console.log("🔐 Auth endpoints: /api/auth/login | /api/auth/signup");
});
