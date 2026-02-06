import express from "express";
import dbPromise from "../database.js";

const router = express.Router();

/* ------------------ helpers ------------------ */

// Decode query param safely (handles %20 and +)
function decodeUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const plusFixed = raw.replace(/\+/g, " ");

  try {
    // Only decode if it looks encoded
    if (/%[0-9A-Fa-f]{2}/.test(plusFixed)) return decodeURIComponent(plusFixed).trim();
  } catch {
    // ignore
  }
  return plusFixed.trim();
}

// Turn any username into a slug form (for matching)
function toSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

/* =========================
   GET creator profile
   - supports slug OR spaced usernames
   - case-insensitive match
   - legacy fallback: match profile_name too
========================= */
router.get("/profile", async (req, res) => {
  try {
    const q = decodeUsername(req.query.username);
    if (!q) return res.status(400).json({ error: "Missing username" });

    const slug = toSlug(q);

    // Candidates we’ll try
    const candidates = uniq([
      q,                  // as provided (decoded)
      slug,               // slug form
      q.toLowerCase(),
      slug.toLowerCase(),
      encodeURIComponent(q), // just in case something stored encoded historically
    ]);

    const db = await dbPromise;

    // Try to find by username (exact or case-insensitive) or profile_name (legacy)
    // Order prefers exact username match first
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
      WHERE
        username IN (${candidates.map(() => "?").join(", ")})
        OR LOWER(username) = LOWER(?)
        OR LOWER(username) = LOWER(?)
        OR LOWER(profile_name) = LOWER(?)
      ORDER BY COALESCE(updated_at, rowid) DESC
      LIMIT 1
      `,
      ...candidates,
      q,
      slug,
      q
    );

    // keep old behavior
    if (!result) return res.json({});

    let social_links = [];
    try {
      social_links = JSON.parse(result.social_links ?? "[]");
    } catch {
      social_links = [];
    }

    return res.json({
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
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* =========================
   UPDATE creator profile
   - updates correct row even if username provided is spaced/slug/case variant
========================= */
router.post("/profile/update", async (req, res) => {
  try {
    const body = req.body || {};
    const incoming = decodeUsername(body.username);

    if (!incoming) return res.status(400).json({ error: "Missing username" });

    const slug = toSlug(incoming);

    const candidates = uniq([
      incoming,
      slug,
      incoming.toLowerCase(),
      slug.toLowerCase(),
      encodeURIComponent(incoming),
    ]);

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

    console.log("[profile/update] incoming:", incoming, "slug:", slug);

    // Update any matching row (username exact/case variants OR profile_name legacy)
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
      WHERE
        username IN (${candidates.map(() => "?").join(", ")})
        OR LOWER(username) = LOWER(?)
        OR LOWER(username) = LOWER(?)
        OR LOWER(profile_name) = LOWER(?)
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
      ...candidates,
      incoming,
      slug,
      incoming
    );

    const changes = updateResult?.changes ?? 0;
    console.log("[profile/update] update changes:", changes);

    // If no row existed, insert using slug (new standard)
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
        slug || incoming,
        profile_name || (slug || incoming),
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

      console.log("[profile/update] insert changes:", insertResult?.changes ?? 0);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Update profile error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
