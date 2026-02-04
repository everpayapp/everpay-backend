// ~/everpay-backend/routes/auth.js
import crypto from "crypto";
import express from "express";
import bcrypt from "bcrypt";
import { Resend } from "resend";
import dbPromise, {
  findCreatorByEmail,
  createCreatorWithPassword,
  getCreatorByUsername,
} from "../database.js";

const router = express.Router();

/* =========================
   Helper: Ensure creator profile row exists
========================= */
async function ensureCreatorProfileRow(creator) {
  try {
    const username = String(creator?.username || "").trim();
    if (!username) return;

    const db = await dbPromise;

    const existing = await db.get(
      "SELECT username FROM creators WHERE username = ? LIMIT 1",
      username
    );

    if (existing) return;

    await db.run(
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
        updated_at,
        email,
        password_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
      `,
      username,
      creator?.profile_name || username,
      "",
      creator?.avatar_url || "",
      "[]",
      "#ec4899",
      "#8b5cf6",
      "#3b82f6",
      0,
      0,
      "",
      creator?.email || null,
      creator?.password_hash || null
    );

    console.log("[ensureCreatorProfileRow] created profile row for:", username);
  } catch (err) {
    console.error("ensureCreatorProfileRow error:", err);
  }
}

/* =========================
   Helper: Send reset email
========================= */
async function sendResetEmail({ to, resetUrl }) {
  const apiKey = process.env.RESEND_API_KEY;

  const from =
    process.env.FROM_EMAIL || "EverPay <no-reply@everpayapp.co.uk>";

  if (!apiKey) throw new Error("RESEND_API_KEY not set on server.");
  const resend = new Resend(apiKey);

  const subject = "Reset your EverPay password";

  const preheader =
    "Use this link to reset your EverPay password (expires in 1 hour).";

  const text = `Reset your EverPay password

Someone requested a password reset for your EverPay creator account.

Reset your password using this link (expires in 1 hour):
${resetUrl}

If you didn’t request this, you can safely ignore this email.`;

  const html = `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${preheader}
  </div>

  <div style="font-family: Arial, sans-serif; line-height: 1.5; color:#111; padding: 24px; background:#f6f7fb;">
    <div style="max-width: 520px; margin: 0 auto; background:#fff; border:1px solid #e7e7ef; border-radius: 14px; padding: 22px;">
      <h2 style="margin:0 0 10px; font-size: 20px;">Reset your password</h2>

      <p style="margin:0 0 14px; color:#333;">
        Someone requested a password reset for your EverPay creator account.
        If this was you, click the button below.
      </p>

      <p style="margin:18px 0;">
        <a href="${resetUrl}"
           style="display:inline-block;background:#0b0f19;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          Reset Password
        </a>
      </p>

      <p style="margin: 14px 0 0; color:#555; font-size: 13px;">
        If the button doesn’t work, copy and paste this link into your browser:
      </p>

      <p style="margin: 8px 0 0; font-size: 13px; word-break: break-all;">
        <a href="${resetUrl}" style="color:#2563eb; text-decoration: underline;">${resetUrl}</a>
      </p>

      <p style="margin:18px 0 0;color:#666;font-size:13px;">
        If you didn’t request this, you can ignore this email.
        This link expires in <strong>1 hour</strong>.
      </p>
    </div>

    <div style="max-width: 520px; margin: 10px auto 0; color:#8a8fa3; font-size: 12px; text-align:center;">
      © ${new Date().getFullYear()} EverPay
    </div>
  </div>`;

  await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });
}

/* =========================
   SIGNUP
========================= */
router.post("/signup", async (req, res) => {
  try {
    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // ✅ Strong normalization (prevents spaces/%20 issues forever)
    const cleanUsername = String(username)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9._-]/g, "");

    const cleanEmail = String(email).trim().toLowerCase();

    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({
        error: "Username must be 3–30 chars and use letters/numbers/._- only (no spaces).",
      });
    }

    const existingEmail = await findCreatorByEmail(cleanEmail);
    if (existingEmail) {
      return res.status(409).json({ error: "Email already in use." });
    }

    const existingUser = await getCreatorByUsername(cleanUsername);
    if (existingUser) {
      return res.status(409).json({ error: "Username already taken." });
    }

    const creator = await createCreatorWithPassword({
      username: cleanUsername,
      email: cleanEmail,
      password,
      display_name: display_name || cleanUsername,
    });

    if (creator) delete creator.password_hash;

    await ensureCreatorProfileRow(creator);

    return res.status(201).json({ creator });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/* =========================
   LOGIN (creator-first only)
========================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password." });
    }

    // ✅ normalize email too
    const cleanEmail = String(email).trim().toLowerCase();

    const creator = await findCreatorByEmail(cleanEmail);
    if (!creator || !creator.password_hash) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = bcrypt.compareSync(password, creator.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    await ensureCreatorProfileRow(creator);

    return res.json({
      creator: {
        username: creator.username,
        email: creator.email,
        profile_name: creator.profile_name,
        role: "creator",
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/* =========================
   FORGOT PASSWORD
========================= */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Missing email." });

    const creator = await findCreatorByEmail(String(email).trim().toLowerCase());

    if (!creator) return res.json({ success: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const db = await dbPromise;

    await db.run(
      `UPDATE creators SET reset_token = ?, reset_expires = ? WHERE username = ?`,
      token,
      expires,
      creator.username
    );

    const baseUrlRaw = process.env.APP_BASE_URL;
    if (!baseUrlRaw) throw new Error("APP_BASE_URL not set on server.");

    const baseUrl = String(baseUrlRaw).replace(/\/+$/, "");

    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await sendResetEmail({ to: creator.email, resetUrl });

    return res.json({ success: true });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({
      error: "Internal server error.",
      detail: String(err?.message || err),
    });
  }
});

/* =========================
   RESET PASSWORD
========================= */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Missing token or newPassword." });
    }

    if (String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters." });
    }

    const db = await dbPromise;

    const row = await db.get(
      `SELECT username, reset_expires FROM creators WHERE reset_token = ?`,
      String(token)
    );

    if (!row) return res.status(400).json({ error: "Invalid or expired token." });

    const exp = row.reset_expires ? new Date(row.reset_expires).getTime() : 0;
    if (!exp || Date.now() > exp) {
      return res.status(400).json({ error: "Invalid or expired token." });
    }

    const hash = bcrypt.hashSync(String(newPassword), 12);

    await db.run(
      `UPDATE creators
       SET password_hash = ?, reset_token = NULL, reset_expires = NULL
       WHERE username = ?`,
      hash,
      row.username
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/* =========================
   DELETE ACCOUNT (with reason)
   - stores feedback
   - deletes payments + creator
========================= */
router.post("/delete-account", async (req, res) => {
  try {
    const { username, reason, detail } = req.body || {};

    const cleanUsername = String(username || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9._-]/g, "");

    if (!cleanUsername) {
      return res.status(400).json({ error: "Missing username." });
    }

    const cleanReason = String(reason || "").trim();
    const cleanDetail = String(detail || "").trim();

    const allowedReasons = new Set([
      "not_using",
      "too_expensive",
      "confusing",
      "missing_features",
      "privacy_concerns",
      "found_alternative",
      "technical_issue",
      "other",
    ]);

    if (!allowedReasons.has(cleanReason)) {
      return res.status(400).json({ error: "Please select a valid reason." });
    }

    const db = await dbPromise;

    const creator = await db.get(
      `SELECT username, email FROM creators WHERE username = ?`,
      cleanUsername
    );

    if (!creator) {
      return res.status(404).json({ error: "Creator not found." });
    }

    // Store feedback first
    await db.run(
      `
      INSERT INTO deletion_feedback (username, email, reason, detail, created_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      creator.username,
      creator.email || null,
      cleanReason,
      cleanDetail || null,
      new Date().toISOString()
    );

    // Delete creator data
    await db.run(`DELETE FROM payments WHERE creator = ?`, cleanUsername);
    await db.run(`DELETE FROM creators WHERE username = ?`, cleanUsername);

    return res.json({ success: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
