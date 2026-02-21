// ~/everpay-backend/routes/topSupporters.js
import express from "express";
import dbPromise from "../database.js";

const router = express.Router();

function startOfMonthISO(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}
function startOfNextMonthISO(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
}

function displayNameFromRow(r) {
  const anon = Number(r.anonymous || 0) === 1;
  if (anon) return "Anonymous";
  const name = String(r.gift_name || "").trim();
  return name.length ? name : "Someone";
}

// Top supporters this month (sum of gifts per supporter)
router.get("/:username", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ error: "Missing username" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "4"), 10) || 4, 1), 10);

    const monthStart = startOfMonthISO();
    const nextMonthStart = startOfNextMonthISO();

    const db = await dbPromise;

    // Pull this month’s gifts for this creator, then group safely in JS (handles anonymous/name rules cleanly)
    const rows = await db.all(
      `
      SELECT amount, gift_name, anonymous, created_at
      FROM payments
      WHERE LOWER(creator)=LOWER(?)
        AND datetime(created_at) >= datetime(?)
        AND datetime(created_at) < datetime(?)
        AND status IS NOT 'failed'
      ORDER BY datetime(created_at) DESC
      `,
      username,
      monthStart,
      nextMonthStart
    );

    const totals = new Map(); // name -> total_pence
    for (const r of rows || []) {
      const name = displayNameFromRow(r);
      const amt = Number(r.amount || 0) || 0;
      totals.set(name, (totals.get(name) || 0) + amt);
    }

    const list = Array.from(totals.entries())
      .map(([name, total_pence]) => ({
        name,
        total_pence,
        total_gbp: Math.round((total_pence / 100) * 100) / 100,
      }))
      .sort((a, b) => b.total_pence - a.total_pence)
      .slice(0, limit);

    res.json({
      username,
      month_start_iso: monthStart,
      next_month_start_iso: nextMonthStart,
      limit,
      top_supporters: list,
    });
  } catch (err) {
    console.error("❌ top supporters error:", err);
    res.status(500).json({ error: "Failed to load top supporters" });
  }
});

export default router;
