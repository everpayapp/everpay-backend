import express from "express";
import bcrypt from "bcrypt";
import {
  findCreatorByEmail,
  createCreatorWithPassword,
  getCreatorByUsername,
} from "../database.js";

const router = express.Router();

/* =========================
   SIGNUP
========================= */
router.post("/signup", (req, res) => {
  try {
    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const existingEmail = findCreatorByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ error: "Email already in use." });
    }

    const existingUser = getCreatorByUsername(username);
    if (existingUser) {
      return res.status(409).json({ error: "Username already taken." });
    }

    const creator = createCreatorWithPassword({
      username,
      email,
      password,
      display_name: display_name || username,
    });

    delete creator.password_hash;

    res.status(201).json({ creator });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* =========================
   LOGIN
========================= */
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password." });
    }

    const creator = findCreatorByEmail(email);
    if (!creator) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    /* =========================
       ADMIN LOGIN (SAFE)
    ========================= */
    if (
      email.toLowerCase() === "lee@everpayapp.co.uk" &&
      process.env.ADMIN_PASSWORD
    ) {
      if (password === process.env.ADMIN_PASSWORD) {
        return res.json({
          creator: {
            username: "admin",
            email,
            role: "admin",
          },
        });
      }
      // If admin password fails, fall through to creator auth
    }

    /* =========================
       CREATOR LOGIN
    ========================= */
    if (!creator.password_hash) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = bcrypt.compareSync(password, creator.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    res.json({
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
// --------------------------------------------------
// 🔑 TEMPORARY PASSWORD RESET (REMOVE AFTER USE)
// --------------------------------------------------
router.post("/reset-password", (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: "Missing email or new password" });
    }

    const creator = findCreatorByEmail(email);
    if (!creator) {
      return res.status(404).json({ error: "User not found" });
    }

    const bcrypt = require("bcrypt");
    const hash = bcrypt.hashSync(newPassword, 12);

    db.prepare(
      `UPDATE creators SET password_hash = ? WHERE email = ?`
    ).run(hash, email);

    res.json({ success: true });
  } catch (err) {
    console.error("Reset error:", err);
    res.status(500).json({ error: "Reset failed" });
  }
});


export default router;
