// ~/everpay-backend/routes/creatorProfile.js
import express from "express";
import db from "../database.js";

const router = express.Router();

/* =====================================
   🔧 SAFE MIGRATIONS (RUN ONCE)
===================================== */
try { db.prepare(`ALTER TABLE creators ADD COLUMN milestone_enabled INTEGER DEFAULT 0`).run(); } catch {}
try { db.prepare(`ALTER TABLE creators ADD COLUMN milestone_amount INTEGER DEFAULT 0`).run(); } catch {}
try { db.prepare(`ALTER TABLE creators ADD COLUMN milestone_text TEXT`).run(); } catch {}

/* =====================================
   GET creator profile
===================================== */
router.get("/profile", (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: "Missing username" });
    }

    const stmt = db.prepare(`SELECT * FROM creators WHERE username = ?`);
    const result = stmt.get(username);

    if (!result) {
      return res.json({});
    }

    let social_links = [];
    try {
      social_links = JSON.parse(result.social_links ?? "[]");
    } catch {
      social_links = [];
    }

    return res.json({
      username: result.username,
      profile_name: result.profile_name,
      bio: result.bio,
      avatar_url: result.avatar_url,
      social_links,
      theme_start: result.theme_start,
      theme_mid: result.theme_mid,
      theme_end: result.theme_end,
      milestone_enabled: result.milestone_enabled ?? 0,
      milestone_amount: result.milestone_amount ?? 0,
      milestone_text: result.milestone_text ?? "",
    });
  } catch (err) {
    console.error("❌ Creator profile GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* =====================================
   UPDATE creator profile
===================================== */
router.post("/profile/update", (req, res) => {
  try {
    const {
      username,
      profile_name,
      bio,
      avatar_url,
      social_links,
      theme_start,
      theme_mid,
      theme_end,
      milestone_enabled,
      milestone_amount,
      milestone_text,
    } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Missing username" });
    }

    const normalizedLinks = Array.isArray(social_links)
      ? JSON.stringify(social_links)
      : JSON.stringify([]);

    const enabledInt =
      milestone_enabled === true ||
      milestone_enabled === 1 ||
      milestone_enabled === "1"
        ? 1
        : 0;

    const amountInt = Number(milestone_amount) || 0;
    const textValue = milestone_text ?? "";

    db.prepare(
      `
      INSERT INTO creators (
        username,
        profile_name,
        bio,
        avatar_url,
        social_links,
        theme_start,
        theme_mid,
        theme_end,
        milestone_enabled,
        milestone_amount,
        milestone_text,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(username) DO UPDATE SET
        profile_name = excluded.profile_name,
        bio = excluded.bio,
        avatar_url = excluded.avatar_url,
        social_links = excluded.social_links,
        theme_start = excluded.theme_start,
        theme_mid = excluded.theme_mid,
        theme_end = excluded.theme_end,
        milestone_enabled = excluded.milestone_enabled,
        milestone_amount = excluded.milestone_amount,
        milestone_text = excluded.milestone_text,
        updated_at = CURRENT_TIMESTAMP
    `
    ).run(
      username,
      profile_name ?? "",
      bio ?? "",
      avatar_url ?? "",
      normalizedLinks,
      theme_start ?? null,
      theme_mid ?? null,
      theme_end ?? null,
      enabledInt,
      amountInt,
      textValue
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Creator profile UPDATE error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
