import Database from "better-sqlite3";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

const db = new Database("everpay.db");

// ---------- Creators table ----------
db.prepare(
  `CREATE TABLE IF NOT EXISTS creators (
      username TEXT PRIMARY KEY,
      profile_name TEXT,
      bio TEXT,
      avatar_url TEXT,
      social_links TEXT,
      updated_at TEXT,
      last_username_change TEXT,
      theme_start TEXT,
      theme_mid TEXT,
      theme_end TEXT,
      email TEXT,
      password_hash TEXT
  )`
).run();

// ---------- Safe add columns for older databases ----------
try { db.prepare(`ALTER TABLE creators ADD COLUMN theme_start TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE creators ADD COLUMN theme_mid TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE creators ADD COLUMN theme_end TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE creators ADD COLUMN email TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE creators ADD COLUMN password_hash TEXT`).run(); } catch {}

// ---------- Payments table ----------
db.prepare(
  `CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      email TEXT,
      creator TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      gift_name TEXT,
      anonymous INTEGER DEFAULT 0,
      gift_message TEXT
  )`
).run();

// ---------- Store a payment ----------
function storePayment(payment) {
  return db
    .prepare(
      `INSERT OR REPLACE INTO payments (
        id, amount, email, creator, status, created_at,
        gift_name, anonymous, gift_message
       )
       VALUES (
         @id, @amount, @email, @creator, @status, @created_at,
         @gift_name, @anonymous, @gift_message
       )`
    )
    .run(payment);
}

// ---------- Creator dashboard payments ----------
function getCreatorPayments(username) {
  return db
    .prepare(
      `SELECT p.*, c.profile_name
       FROM payments p
       LEFT JOIN creators c ON p.creator = c.username
       WHERE p.creator = ?
       ORDER BY datetime(p.created_at) DESC`
    )
    .all(username);
}

// ---------- Business dashboard payments ----------
function getPayments(limit = 100) {
  return db
    .prepare(
      `SELECT p.*, c.profile_name
       FROM payments p
       LEFT JOIN creators c ON p.creator = c.username
       ORDER BY datetime(p.created_at) DESC
       LIMIT ?`
    )
    .all(limit);
}

// ---------- Payments filtered by creator ----------
function getPaymentsByCreator(username, limit = 100) {
  return db
    .prepare(
      `SELECT p.*, c.profile_name
       FROM payments p
       LEFT JOIN creators c ON p.creator = c.username
       WHERE p.creator = ?
       ORDER BY datetime(p.created_at) DESC
       LIMIT ?`
    )
    .all(username, limit);
}

// ---------- Profile lookups ----------
function getCreatorByUsername(username) {
  return db
    .prepare(`SELECT * FROM creators WHERE username = ?`)
    .get(username);
}

function getCreatorProfile(username) {
  return db
    .prepare(`SELECT * FROM creators WHERE username = ?`)
    .get(username);
}

// ---------- Save / update creator profile ----------
function saveCreatorProfile(profile) {
  return db
    .prepare(
      `INSERT OR REPLACE INTO creators (
        username, profile_name, bio, avatar_url, social_links,
        theme_start, theme_mid, theme_end, updated_at,
        email, password_hash
      )
      VALUES (
        @username, @profile_name, @bio, @avatar_url, @social_links,
        @theme_start, @theme_mid, @theme_end, @updated_at,
        @email, @password_hash
      )`
    )
    .run({
      ...profile,
      updated_at: new Date().toISOString()
    });
}

// ---------- Update creator username ----------
function updateCreatorUsername(oldUsername, newUsername) {
  return db
    .prepare(
      `UPDATE creators
       SET username = ?, last_username_change = ?
       WHERE username = ?`
    )
    .run(newUsername, new Date().toISOString(), oldUsername);
}

// ----------------------------------------------------
// 🔐 SECURE AUTH HELPERS (ADDED SAFELY, NO BREAKING CHANGES)
// ----------------------------------------------------

// Find a creator using email
function findCreatorByEmail(email) {
  return db
    .prepare(`SELECT * FROM creators WHERE email = ?`)
    .get(email);
}

// Create a creator with secure hashed password (signup)
function createCreatorWithPassword({ username, email, password, display_name }) {
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

  const stmt = db.prepare(
    `INSERT INTO creators (
      username,
      profile_name,
      email,
      password_hash
    ) VALUES (?, ?, ?, ?)`
  );

  stmt.run(username, display_name, email, passwordHash);

  return findCreatorByEmail(email);
}

// Optional helper: get by internal rowid (not usually needed, but safe)
function getCreatorById(id) {
  return db
    .prepare(`SELECT rowid, * FROM creators WHERE rowid = ?`)
    .get(id);
}

// ---------- EXPORTS ----------
export {
  storePayment,
  getPayments,
  getPaymentsByCreator,
  getCreatorPayments,
  getCreatorByUsername,
  updateCreatorUsername,
  getCreatorProfile,
  saveCreatorProfile,
  findCreatorByEmail,
  createCreatorWithPassword,
  getCreatorById
};

export default db;
