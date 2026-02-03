import express from "express";
import dbPromise from "../database.js";

const router = express.Router();

// GET creator profile
router.get("/profile", async (req, res) => {
  try {
    const username = String(req.query.username || "").trim();
    if (!username) {
      return res.status(400).json({ error: "Missing username" });
    }

    const db = await dbPromise;

    // ✅ If duplicates exist, always return the newest row
    const result = await db.get(
      `
      SELECT
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
      FROM creators
      WHERE username = ?
      ORDER BY COALESCE(updated_at, created_at, rowid) DESC
      LIMIT 1
      `,
      username
    );

    if (!result) {
      return res.status(404).json({ error: "Creator not found" });
    }

    let social_links = [];
    try {
      social_links = JSON.parse(result.social_links ?? "[]");
    } catch {
      social_links = [];
    }

    res.json({
      username: result.username,
      profile_name: result.profile_name ?? "",
      bio: result.bio ?? "",
      avatar_url: result.avatar_url ?? "",
      social_links: Array.isArray(social_links) ? social_links : [],
      theme_start: result.theme_start ?? null,
      theme_mid: result.theme_mid ?? null,
      theme_end: result.theme_end ?? null,
      milestone_enabled: result.milestone_enabled ?? 0,
      milestone_amount: result.milestone_amount ?? 0,
      milestone_text: result.milestone_text ?? "",
    });
  } catch (err) {
    console.error("Creator profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// UPDATE creator profile
router.post("/profile/update", async (req, res) => {
  try {
    const body = req.body || {};
    const username = typeof body.username === "string" ? body.username.trim() : "";

    if (!username) {
      return res.status(400).json({ error: "Missing username" });
    }

    const db = await dbPromise;

    const normalizedLinks = JSON.stringify(
      Array.isArray(body.social_links) ? body.social_links : []
    );

    const enabledInt =
      body.milestone_enabled === true ||
      body.milestone_enabled === 1 ||
      body.milestone_enabled === "1"
        ? 1
        : 0;

    const profile_name = body.profile_name ?? "";
    const bio = body.bio ?? "";
    const avatar_url = body.avatar_url ?? "";
    const theme_start = body.theme_start ?? null;
    const theme_mid = body.theme_mid ?? null;
    const theme_end = body.theme_end ?? null;
    const milestone_amount = Number(body.milestone_amount) || 0;
    const milestone_text = body.milestone_text ?? "";

    // ✅ Debug proof in logs (Render/local)
    console.log("[profile/update] username:", username);

    // ✅ Safer than UPSERT: UPDATE first
    const updateResult = await db.run(
      `
      UPDATE creators SET
        profile_name = ?,
        bio = ?,
        avatar_url = ?,
        social_links = ?,
        theme_start = ?,
        theme_mid = ?,
        theme_end = ?,
        milestone_enabled = ?,
        milestone_amount = ?,
        milestone_text = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
      `,
      profile_name,
      bio,
      avatar_url,
      normalizedLinks,
      theme_start,
      theme_mid,
      theme_end,
      enabledInt,
      milestone_amount,
      milestone_text,
      username
    );

    const changes = updateResult?.changes ?? 0;
    console.log("[profile/update] update changes:", changes);

    // If no row existed, INSERT a new one
    if (changes === 0) {
      const insertResult = await db.run(
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
        `,
        username,
        profile_name,
        bio,
        avatar_url,
        normalizedLinks,
        theme_start,
        theme_mid,
        theme_end,
        enabledInt,
        milestone_amount,
        milestone_text
      );

      console.log(
        "[profile/update] insert changes:",
        insertResult?.changes ?? 0
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
