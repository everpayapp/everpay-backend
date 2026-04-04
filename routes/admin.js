// ~/everpay-backend/routes/admin.js
import express from "express";
import dbPromise, { getPayments } from "../database.js";

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

    const recentGifts = await getPayments(12);

    const users = await db.all(`
      SELECT
        c.username,
        c.email,
        c.profile_name,
        c.stripe_account_id,
        c.updated_at,
        COALESCE(COUNT(p.id), 0) as gifts_count,
        COALESCE(SUM(COALESCE(p.gift_amount, p.amount)), 0) as gross_volume_pence,
        COALESCE(SUM(
          CASE
            WHEN p.net_amount IS NOT NULL AND p.net_amount > 0 THEN p.net_amount
            ELSE COALESCE(p.amount, 0)
          END
        ), 0) as net_volume_pence,
        COALESCE(SUM(COALESCE(p.fee_amount, 0)), 0) as everpay_revenue_pence,
        MAX(p.created_at) as last_gift_at
      FROM creators c
      LEFT JOIN payments p
        ON LOWER(p.creator) = LOWER(c.username)
      GROUP BY
        c.username,
        c.email,
        c.profile_name,
        c.stripe_account_id,
        c.updated_at
      ORDER BY datetime(c.updated_at) DESC
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
      users: (users || []).map((user) => ({
        ...user,
        gifts_count: Number(user.gifts_count || 0),
        gross_volume_pence: Number(user.gross_volume_pence || 0),
        net_volume_pence: Number(user.net_volume_pence || 0),
        everpay_revenue_pence: Number(user.everpay_revenue_pence || 0),
      })),
      recent_gifts: recentGifts || [],
    });
  } catch (err) {
    console.error("❌ /api/admin/stats error:", err);
    res.status(500).json({ error: "Failed to load admin stats" });
  }
});

export default router;
