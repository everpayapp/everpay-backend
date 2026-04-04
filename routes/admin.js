// ~/everpay-backend/routes/admin.js
import express from "express";
import dbPromise from "../database.js";

const router = express.Router();

const OWNER_EMAIL = "lee@everpayapp.co.uk";

router.get("/stats", async (req, res) => {
  try {
    const requesterEmail = String(req.query.email || "").trim().toLowerCase();

    if (!requesterEmail || requesterEmail !== OWNER_EMAIL) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const db = await dbPromise;

    const totalUsersRow = await db.get(`
      SELECT COUNT(*) as count
      FROM creators
    `);

    const connectedCreatorsRow = await db.get(`
      SELECT COUNT(*) as count
      FROM creators
      WHERE stripe_account_id IS NOT NULL
        AND TRIM(stripe_account_id) <> ''
    `);

    const totalGiftsRow = await db.get(`
      SELECT COUNT(*) as count
      FROM payments
    `);

    const giftVolumeRow = await db.get(`
      SELECT COALESCE(SUM(gift_amount), 0) as total
      FROM payments
    `);

    const everpayRevenueRow = await db.get(`
      SELECT COALESCE(SUM(fee_amount), 0) as total
      FROM payments
    `);

    const totalNetPayoutsRow = await db.get(`
      SELECT COALESCE(SUM(
        CASE
          WHEN net_amount IS NOT NULL AND net_amount > 0 THEN net_amount
          ELSE amount
        END
      ), 0) as total
      FROM payments
    `);

    const recentSignups = await db.all(`
      SELECT
        username,
        email,
        profile_name,
        stripe_account_id,
        updated_at
      FROM creators
      ORDER BY datetime(updated_at) DESC
      LIMIT 10
    `);

    const recentGifts = await db.all(`
      SELECT
        id,
        creator,
        gift_name,
        anonymous,
        gift_message,
        gift_amount,
        fee_amount,
        stripe_fee_amount,
        net_amount,
        created_at,
        status
      FROM payments
      ORDER BY datetime(created_at) DESC
      LIMIT 10
    `);

    res.json({
      totals: {
        total_users: Number(totalUsersRow?.count || 0),
        connected_creators: Number(connectedCreatorsRow?.count || 0),
        total_gifts: Number(totalGiftsRow?.count || 0),
        gift_volume_pence: Number(giftVolumeRow?.total || 0),
        everpay_revenue_pence: Number(everpayRevenueRow?.total || 0),
        total_net_payouts_pence: Number(totalNetPayoutsRow?.total || 0),
      },
      recent_signups: recentSignups || [],
      recent_gifts: recentGifts || [],
    });
  } catch (err) {
    console.error("❌ /api/admin/stats error:", err);
    res.status(500).json({ error: "Failed to load admin stats" });
  }
});

export default router;
