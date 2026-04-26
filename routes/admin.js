// ~/everpay-backend/routes/admin.js
import express from "express";
import dbPromise, { getPayments } from "../database.js";

const router = express.Router();

const OWNER_EMAIL = "lee@everpayapp.co.uk";

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

router.get("/stats", async (req, res) => {
  try {
    const requesterEmail = norm(req.query.email);

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

    const creators = await db.all(`
      SELECT
        username,
        email,
        profile_name,
        stripe_account_id,
        updated_at
      FROM creators
      ORDER BY datetime(updated_at) DESC
    `);

    const payments = await getPayments(10000);

    const totalGifts = payments.length;

    const giftVolumePence = payments.reduce(
      (sum, p) => sum + Number(p.gift_amount || p.amount || 0),
      0
    );

    const everpayRevenuePence = payments.reduce(
      (sum, p) => sum + Number(p.fee_amount || 0),
      0
    );

    const totalNetPayoutsPence = payments.reduce((sum, p) => {
      const net = Number(p.net_amount || 0);
      const fallback = Number(p.amount || 0);
      return sum + (net > 0 ? net : fallback);
    }, 0);

    const users = (creators || []).map((creator) => {
      const creatorPayments = payments.filter(
        (p) => norm(p.creator) === norm(creator.username)
      );

      const giftsCount = creatorPayments.length;

      const grossVolumePence = creatorPayments.reduce(
        (sum, p) => sum + Number(p.gift_amount || p.amount || 0),
        0
      );

      const netVolumePence = creatorPayments.reduce((sum, p) => {
        const net = Number(p.net_amount || 0);
        const fallback = Number(p.amount || 0);
        return sum + (net > 0 ? net : fallback);
      }, 0);

      const everpayRevenueFromCreatorPence = creatorPayments.reduce(
        (sum, p) => sum + Number(p.fee_amount || 0),
        0
      );

      const lastGiftAt =
        creatorPayments.length > 0 ? creatorPayments[0].created_at : null;

      return {
        ...creator,
        gifts_count: giftsCount,
        gross_volume_pence: grossVolumePence,
        net_volume_pence: netVolumePence,
        everpay_revenue_pence: everpayRevenueFromCreatorPence,
        last_gift_at: lastGiftAt,
      };
    });

    res.json({
      totals: {
        total_users: Number(totalUsersRow?.count || 0),
        connected_creators: Number(connectedCreatorsRow?.count || 0),
        total_gifts: totalGifts,
        gift_volume_pence: giftVolumePence,
        everpay_revenue_pence: everpayRevenuePence,
        total_net_payouts_pence: totalNetPayoutsPence,
      },
      users,
      recent_gifts: payments.slice(0, 12),
    });
  } catch (err) {
    console.error("❌ /api/admin/stats error:", err);
    res.status(500).json({ error: "Failed to load admin stats" });
  }
});

export default router;
