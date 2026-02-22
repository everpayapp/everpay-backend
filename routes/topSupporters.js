// ~/everpay-backend/routes/topSupporters.js
import express from "express";
import dbPromise from "../database.js";

const router = express.Router();

const norm = (v) => String(v || "").trim().toLowerCase();

// Kept for response/debugging consistency (not used for math anymore)
// because Option 2 stores gift vs total explicitly.
function getSupporterFeeBps() {
  const raw =
    process.env.SUPPORTER_FEE_BPS ??
    process.env.APP_FEE_BPS ??
    process.env.EVERPAY_FEE_BPS;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 250; // default 2.5%
}

function monthRangeUTC(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0));
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0));
  return { start, next };
}

// GET /api/top-supporters/:username?limit=4
router.get("/:username", async (req, res) => {
  try {
    const username = norm(req.params.username);
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 4));

    const { start, next } = monthRangeUTC(new Date());
    const startIso = start.toISOString();
    const nextIso = next.toISOString();

    const supporterFeeBps = getSupporterFeeBps();
    const db = await dbPromise;

    // Option 2 truth:
    // - gift_amount (or fallback amount) is what creators should see
    // - total_paid (or fallback amount) is what the supporter actually paid
    const rows = await db.all(
      `
      SELECT
        COALESCE(NULLIF(TRIM(gift_name), ''), 'Someone') AS supporter_name,
        COALESCE(anonymous, 0) AS anonymous,

        -- Gift-only sum (Option 2 uses gift_amount; legacy falls back to amount)
        SUM(COALESCE(gift_amount, amount)) AS gift_sum_pence,

        -- Total paid sum (Option 2 uses total_paid; legacy falls back to amount)
        SUM(COALESCE(total_paid, amount)) AS total_sum_pence,

        COUNT(*) AS gifts_count
      FROM payments
      WHERE (
        LOWER(COALESCE(creator_username, creator)) = LOWER(?)
      )
      AND datetime(created_at) >= datetime(?)
      AND datetime(created_at) < datetime(?)
      AND COALESCE(LOWER(status), '') NOT IN ('failed', 'canceled', 'cancelled')
      GROUP BY supporter_name, anonymous
      ORDER BY gift_sum_pence DESC
      LIMIT ?
      `,
      username,
      startIso,
      nextIso,
      limit
    );

    const top_supporters = (rows || []).map((r) => {
      const giftSum = Number(r.gift_sum_pence) || 0;
      const totalSum = Number(r.total_sum_pence) || 0;

      const name = Number(r.anonymous) === 1 ? "Anonymous" : String(r.supporter_name || "Someone");

      return {
        name,
        gifts_count: Number(r.gifts_count) || 0,

        // ✅ Always gift-only leaderboard totals
        gift_total_pence: giftSum,
        gift_total_gbp: Math.round(giftSum) / 100,

        // Optional debug/analytics:
        total_paid_pence: totalSum,
        total_paid_gbp: Math.round(totalSum) / 100,
      };
    });

    return res.json({
      username,
      month_start_iso: startIso,
      next_month_start_iso: nextIso,
      limit,
      supporter_fee_bps: supporterFeeBps,
      top_supporters,
    });
  } catch (err) {
    console.error("❌ /api/top-supporters error:", err);
    return res.status(500).json({ error: "Failed to load top supporters" });
  }
});

export default router;
