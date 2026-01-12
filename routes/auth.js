import crypto from "crypto";
import express from "express";
import bcrypt from "bcrypt";
import dbPromise, {
  findCreatorByEmail,
  createCreatorWithPassword,
  getCreatorByUsername,
} from "../database.js";

const router = express.Router();

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

    // ✅ Creator login only (admin shortcut removed)
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

    // For now: return token in response (dev/testing).
    // Later: email this link via email provider.
    return res.json({
      success: true,
      resetToken: token,
      expires,
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "Internal server error." });
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
      return res.status(400).json({ error: "Password must be at least 8 characters." });
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

