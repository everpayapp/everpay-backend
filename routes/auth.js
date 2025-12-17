import express from "express";
import bcrypt from "bcrypt";
import {
  findCreatorByEmail,
  createCreatorWithPassword,
  getCreatorByUsername
} from "../database.js";

const router = express.Router();

// ---------- SIGNUP ----------
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
      display_name: display_name || username
    });

    delete creator.password_hash;

    res.status(201).json({ creator });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ---------- LOGIN ----------
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password." });
    }

    /* --------------------------------------------------
       🔐 ADMIN LOGIN (for business dashboard: lee only)
    -------------------------------------------------- */
    if (email.toLowerCase() === "lee@everpayapp.co.uk") {
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "EverPay2025";

      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Invalid admin password." });
      }

      return res.json({
        creator: {
          username: "admin",
          email: "lee@everpayapp.co.uk",
          role: "admin",
        },
      });
    }

    /* --------------------------------------------------
       👤 CREATOR LOGIN (normal users)
    -------------------------------------------------- */
    const creator = findCreatorByEmail(email);
    if (!creator) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = bcrypt.compareSync(password, creator.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const safeCreator = {
      username: creator.username,
      email: creator.email,
      profile_name: creator.profile_name,
      role: "creator",
    };

    res.json({ creator: safeCreator });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
