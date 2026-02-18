import express from "express";
import dbPromise from "../database.js";

const router = express.Router();

// GET /api/prize-pool
// Sums this month's creator gifts (pence) from SQLite and applies PRIZE_POOL_BPS.
// Returns: prize_pool_pence, prize_pool_gbp, gifts_count, total_gifts_gbp, month_start_iso
router.get("/", async (req, res) => {
  try {
    const bpsRaw = process.env.PRIZE_POOL_BPS;
    const bps = Number(bpsRaw);

    // Safe fallback if missing/invalid (0.50%)
    const safeBps = Number.isFinite(bps) && bps >= 0 ? bps : 50;

    // UTC month boundaries (consistent in Render + local)
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));

    const db = await dbPromise;

    // Only count creator gifts (creator not null/empty), amount > 0, within this month
    const row = await db.get(
      `
      SELECT
        COALESCE(SUM(amount), 0) AS total_pence,
        COUNT(*) AS gifts_count
      FROM payments
      WHERE amount > 0
        AND creator IS NOT NULL
        AND TRIM(creator) <> ''
        AND datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
      `,
      monthStart.toISOString(),
      nextMonthStart.toISOString()
    );

    const totalPence = Number(row?.total_pence || 0);
    const giftsCount = Number(row?.gifts_count || 0);

    const prizePoolPence = Math.floor((totalPence * safeBps) / 10000);

    res.json({
      prize_pool_pence: prizePoolPence,
      prize_pool_gbp: Number((prizePoolPence / 100).toFixed(2)),
      gifts_count: giftsCount,
      total_gifts_gbp: Number((totalPence / 100).toFixed(2)),
      prize_pool_bps: safeBps,
      month_start_iso: monthStart.toISOString(),
    });
  } catch (err) {
    console.error("❌ Error calculating prize pool:", err);
    res.status(500).json({ error: "Failed to calculate prize pool" });
  }
});

export default router;
