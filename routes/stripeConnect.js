// ~/everpay-backend/routes/stripeConnect.js
import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import dbPromise from "../database.js";

dotenv.config();

const router = express.Router();

const { STRIPE_SECRET_KEY, FRONTEND_URL } = process.env;
if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");
if (!FRONTEND_URL) throw new Error("Missing FRONTEND_URL");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// --- Ensure DB has stripe_account_id column (safe) ---
async function ensureStripeColumn() {
  const db = await dbPromise;
  try {
    await db.exec("ALTER TABLE creators ADD COLUMN stripe_account_id TEXT");
  } catch {
    // ignore if column already exists
  }
}
ensureStripeColumn();

function norm(u) {
  return String(u || "").trim();
}

// ✅ Find creator by username OR profile_name (case-insensitive)
async function getCreator(usernameOrName) {
  const db = await dbPromise;
  const u = norm(usernameOrName);

  return db.get(
    `
    SELECT username, stripe_account_id
    FROM creators
    WHERE LOWER(username) = LOWER(?)
       OR LOWER(profile_name) = LOWER(?)
    LIMIT 1
    `,
    u,
    u
  );
}

// ✅ Update by actual stored username (not whatever was typed)
async function setStripeAccountId(usernameOrName, stripe_account_id) {
  const db = await dbPromise;
  const creator = await getCreator(usernameOrName);

  if (!creator?.username) {
    throw new Error("Creator not found (cannot set stripe_account_id)");
  }

  await db.run(
    "UPDATE creators SET stripe_account_id = ? WHERE username = ?",
    stripe_account_id,
    creator.username
  );
}

/**
 * Decide if an existing connected account should be thrown away
 * and replaced with a fresh one.
 */
function shouldReplaceAccount(account) {
  const disabledReason = account?.requirements?.disabled_reason || "";

  if (!disabledReason) return false;

  // Stripe has rejected or permanently blocked this account
  if (
    disabledReason.includes("rejected") ||
    disabledReason.includes("listed") ||
    disabledReason.includes("fraud") ||
    disabledReason.includes("other")
  ) {
    return true;
  }

  return false;
}

/**
 * GET /api/stripe/connect/status?username=lee
 */
router.get("/connect/status", async (req, res) => {
  try {
    const username = String(req.query.username || "").trim();
    if (!username) return res.status(400).json({ error: "Missing username" });

    const creator = await getCreator(username);
    if (!creator) return res.status(404).json({ error: "Creator not found" });

    if (!creator.stripe_account_id) return res.json({ connected: false });

    const account = await stripe.accounts.retrieve(creator.stripe_account_id);

    const chargesEnabled = !!account.charges_enabled;
    const payoutsEnabled = !!account.payouts_enabled;
    const requirementsDue = Array.isArray(account.requirements?.currently_due)
      ? account.requirements.currently_due
      : [];
    const disabledReason = account.requirements?.disabled_reason || null;

    return res.json({
      connected: true,
      stripe_account_id: creator.stripe_account_id,
      chargesEnabled,
      payoutsEnabled,
      requirementsDue,
      disabledReason,
    });
  } catch (err) {
    console.error("❌ connect/status error:", err);
    return res.status(500).json({ error: "Failed to check Connect status" });
  }
});

/**
 * POST /api/stripe/connect/create
 * body: { username: "lee" }
 */
router.post("/connect/create", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    if (!username) return res.status(400).json({ error: "Missing username" });

    const creator = await getCreator(username);
    if (!creator) return res.status(404).json({ error: "Creator not found" });

    let accountId = creator.stripe_account_id;

    // If an account already exists, check whether Stripe has rejected it
    if (accountId) {
      try {
        const existingAccount = await stripe.accounts.retrieve(accountId);

        if (shouldReplaceAccount(existingAccount)) {
          console.log(
            "⚠️ Existing Stripe account rejected/unusable, creating a fresh one:",
            accountId
          );
          accountId = null;
        }
      } catch (err) {
        console.log(
          "⚠️ Failed to retrieve existing Stripe account, creating a fresh one:",
          accountId
        );
        accountId = null;
      }
    }

    // Create account if missing or rejected
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        business_profile: {
          product_description: "Creator gifts via EverPay",
        },
        metadata: { username },
      });

      accountId = account.id;
      await setStripeAccountId(username, accountId);
    }

    // Onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${FRONTEND_URL}/creator/settings?connect=refresh`,
      return_url: `${FRONTEND_URL}/creator/settings?connect=return`,
      type: "account_onboarding",
    });

    return res.json({ url: accountLink.url, stripe_account_id: accountId });
  } catch (err) {
    console.error("❌ connect/create error:", err);
    console.error("❌ Stripe raw message:", err?.message);
    console.error("❌ Stripe raw type:", err?.type);
    console.error("❌ Stripe raw code:", err?.code);

    return res.status(500).json({
      error: "Failed to create Connect link",
      details: err?.message || "Unknown error",
    });
  }
});

/**
 * POST /api/stripe/connect/login
 * body: { username: "lee" }
 */
router.post("/connect/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    if (!username) return res.status(400).json({ error: "Missing username" });

    const creator = await getCreator(username);
    if (!creator || !creator.stripe_account_id) {
      return res.status(404).json({ error: "Connect not set up yet" });
    }

    const loginLink = await stripe.accounts.createLoginLink(
      creator.stripe_account_id
    );

    return res.json({ url: loginLink.url });
  } catch (err) {
    console.error("❌ connect/login error:", err);
    return res.status(500).json({ error: "Failed to create login link" });
  }
});

export default router;
