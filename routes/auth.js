import express from "express";
import bcrypt from "bcrypt";
import dbPromise, {
  findCreatorByEmail,
  createCreatorWithPassword,
  getCreatorByUsername,
} from "../database.js";

const router = express.Router();

const ADMIN_EMAIL = "lee@everpayapp.co.uk";

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
   LOGIN
========================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password." });
    }

    // ✅ Admin login (only if ADMIN_PASSWORD matches)
    if (email.toLowerCase() === ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      if (password === process.env.ADMIN_PASSWORD) {
        return res.json({
          creator: { username: "admin", email, role: "admin" },
        });
      }
      // If admin password fails, fall through to creator auth
    }

    // ✅ Creator login
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

/* ==========================================================
   🔧 TEMP ADMIN-ONLY FIX: Set email + password for a username
   - Requires admin email + ADMIN_PASSWORD
   - Use ONCE to repair 'lee' in production, then remove
========================================================== */
router.post("/admin/fix-creator", async (req, res) => {
  try {
    const { adminEmail, adminPassword, username, email, newPassword } = req.body;

    if (!adminEmail || !adminPassword) {
      return res.status(401).json({ error: "Missing admin credentials." });
    }

    if (
      adminEmail.toLowerCase() !== ADMIN_EMAIL ||
      !process.env.ADMIN_PASSWORD ||
      adminPassword !== process.env.ADMIN_PASSWORD
    ) {
      return res.status(401).json({ error: "Invalid admin credentials." });
    }

    if (!username || !email || !newPassword) {
      return res
        .status(400)
        .json({ error: "Missing username, email, or newPassword." });
    }

    const db = await dbPromise;

    const existingUser = await getCreatorByUsername(username);
    if (!existingUser) {
      return res.status(404).json({ error: "Username not found." });
    }

    // If email is used by someone else, block it
    const emailOwner = await findCreatorByEmail(email);
    if (emailOwner && emailOwner.username !== username) {
      return res.status(409).json({ error: "Email already in use." });
    }

    const hash = bcrypt.hashSync(newPassword, 12);

    await db.run(
      `UPDATE creators
       SET email = ?, password_hash = ?
       WHERE username = ?`,
      email,
      hash,
      username
    );

    return res.json({ success: true, updated: { username, email } });
  } catch (err) {
    console.error("Admin fix error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
