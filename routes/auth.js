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
   Helper: Send reset email
========================= */
async function sendResetEmail({ to, resetUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL || "EverPay <onboarding@resend.dev>";

  if (!apiKey) throw new Error("RESEND_API_KEY not set on server.");
  const resend = new Resend(apiKey);

  const subject = "Reset your EverPay password";

  const html = `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color:#111;">
    <h2 style="margin:0 0 10px;">Reset your password</h2>
    <p style="margin:0 0 14px;">
      Someone requested a password reset for your EverPay creator account.
      If this was you, click the button below:
    </p>
    <p style="margin:18px 0;">
      <a href="${resetUrl}"
         style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;">
        Reset Password
      </a>
    </p>
    <p style="margin:18px 0 0;color:#555;font-size:13px;">
      If you didn’t request this, you can ignore this email.
      This link expires in 1 hour.
    </p>
  </div>`;

  await resend.emails.send({
    from,
    to,
    subject,
    html,
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

    const existingEmail = await findCreatorByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ error: "Email already in use." });
    }

    const existingUser = await getCreatorByUsername(username);
    if (existingUser) {
      return res.status(409).json({ error: "Username already taken." });
    }

    const creator = await createCreatorWithPassword({
      username,
      email,
      password,
      display_name: display_name || username,
    });

    if (creator) delete creator.password_hash;

    res.status(201).json({ creator });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error." });
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

    const creator = await findCreatorByEmail(email);
    if (!creator || !creator.password_hash) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = bcrypt.compareSync(password, creator.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

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
    res.status(500).json({ error: "Internal server error." });
  }
});

/* =========================
   FORGOT PASSWORD
   - Generates reset token
   - Emails reset link via Resend
========================= */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Missing email." });

    const creator = await findCreatorByEmail(String(email).trim());

    // Always return success to avoid email enumeration
    if (!creator) return res.json({ success: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    const db = await dbPromise;

    await db.run(
      `UPDATE creators SET reset_token = ?, reset_expires = ? WHERE username = ?`,
      token,
      expires,
      creator.username
    );

    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error("APP_BASE_URL not set on server.");

    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(
      token
    )}`;

    // Send email
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
   - Uses token to set new password
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

export default router;

