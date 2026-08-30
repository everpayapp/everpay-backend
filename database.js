import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

// Render-safe persistent DB location
const DB_PATH = process.env.RENDER ? "/data/everpay.db" : "everpay.db";

const dbPromise = open({
  filename: DB_PATH,
  driver: sqlite3.Database,
});

// ---------- INIT ----------
async function init() {
  const db = await dbPromise;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS creators (
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
    )
  `);

  const safeAlter = async (sql) => {
    try {
      await db.exec(sql);
    } catch {}
  };

  await safeAlter(`ALTER TABLE creators ADD COLUMN milestone_enabled INTEGER DEFAULT 0`);
  await safeAlter(`ALTER TABLE creators ADD COLUMN milestone_amount INTEGER DEFAULT 0`);
  await safeAlter(`ALTER TABLE creators ADD COLUMN milestone_text TEXT DEFAULT ''`);
  await safeAlter(`ALTER TABLE creators ADD COLUMN reset_token TEXT`);
  await safeAlter(`ALTER TABLE creators ADD COLUMN reset_expires TEXT`);
  await safeAlter(`ALTER TABLE creators ADD COLUMN stripe_account_id TEXT`);
  await safeAlter(
    `ALTER TABLE creators ADD COLUMN thank_you_video TEXT DEFAULT ''`
  );

  await db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      email TEXT,
      creator TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      gift_name TEXT,
      anonymous INTEGER DEFAULT 0,
      gift_message TEXT
    )
  `);

  await safeAlter(`ALTER TABLE payments ADD COLUMN gift_amount INTEGER`);
  await safeAlter(`ALTER TABLE payments ADD COLUMN fee_amount INTEGER`);
  await safeAlter(`ALTER TABLE payments ADD COLUMN total_paid INTEGER`);
  await safeAlter(`ALTER TABLE payments ADD COLUMN stripe_fee_amount INTEGER DEFAULT 0`);
  await safeAlter(`ALTER TABLE payments ADD COLUMN net_amount INTEGER DEFAULT 0`);

  await db.exec(`
    UPDATE payments
    SET
      gift_amount = COALESCE(gift_amount, amount),
      fee_amount = COALESCE(fee_amount, 0),
      total_paid = COALESCE(total_paid, amount),
      stripe_fee_amount = COALESCE(stripe_fee_amount, 0),
      net_amount = COALESCE(net_amount, gift_amount, amount)
    WHERE
      gift_amount IS NULL OR
      fee_amount IS NULL OR
      total_paid IS NULL OR
      stripe_fee_amount IS NULL OR
      net_amount IS NULL;
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS deletion_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      email TEXT,
      reason TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

init();

const norm = (v) => String(v || "").trim();

function toMillis(value) {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function paymentQuality(payment) {
  const stripeFee = Number(payment?.stripe_fee_amount || 0);
  const net = Number(payment?.net_amount || 0);
  if (stripeFee > 0 || net > 0) return 2;
  return 1;
}

function sameLogicalPayment(a, b) {
  const timeDiff = Math.abs(toMillis(a.created_at) - toMillis(b.created_at));

  return (
    norm(a.creator).toLowerCase() === norm(b.creator).toLowerCase() &&
    norm(a.email).toLowerCase() === norm(b.email).toLowerCase() &&
    norm(a.gift_name).toLowerCase() === norm(b.gift_name).toLowerCase() &&
    norm(a.gift_message) === norm(b.gift_message) &&
    Number(a.gift_amount || a.amount || 0) === Number(b.gift_amount || b.amount || 0) &&
    Number(a.fee_amount || 0) === Number(b.fee_amount || 0) &&
    Number(a.total_paid || 0) === Number(b.total_paid || 0) &&
    Number(a.anonymous || 0) === Number(b.anonymous || 0) &&
    timeDiff <= 30000
  );
}

function chooseBetterPayment(a, b) {
  const qa = paymentQuality(a);
  const qb = paymentQuality(b);

  if (qb > qa) return b;
  if (qa > qb) return a;

  return toMillis(b.created_at) > toMillis(a.created_at) ? b : a;
}

function dedupePayments(rows) {
  const sorted = [...rows].sort(
    (a, b) => toMillis(b.created_at) - toMillis(a.created_at)
  );

  const result = [];

  for (const row of sorted) {
    const existingIndex = result.findIndex((item) => sameLogicalPayment(item, row));

    if (existingIndex === -1) {
      result.push(row);
    } else {
      result[existingIndex] = chooseBetterPayment(result[existingIndex], row);
    }
  }

  return result.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
}

// ---------- Store payment ----------
async function storePayment(payment) {
  const db = await dbPromise;

  const gift = Number.isInteger(payment.gift_amount)
    ? payment.gift_amount
    : payment.amount;

  const fee = Number.isInteger(payment.fee_amount)
    ? payment.fee_amount
    : 0;

  const total = Number.isInteger(payment.total_paid)
    ? payment.total_paid
    : gift + fee;

  const stripeFee = Number.isInteger(payment.stripe_fee_amount)
    ? payment.stripe_fee_amount
    : 0;

  const net = Number.isInteger(payment.net_amount)
    ? payment.net_amount
    : Math.max(gift - stripeFee, 0);

  return db.run(
    `
    INSERT OR REPLACE INTO payments (
      id, amount, gift_amount, fee_amount, total_paid, stripe_fee_amount, net_amount,
      email, creator, status, created_at,
      gift_name, anonymous, gift_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    payment.id,
    gift,
    gift,
    fee,
    total,
    stripeFee,
    net,
    payment.email,
    payment.creator,
    payment.status,
    payment.created_at,
    payment.gift_name,
    payment.anonymous,
    payment.gift_message
  );
}

// ---------- Payments ----------
async function getPayments(limit = 100) {
  const db = await dbPromise;

  const rows = await db.all(
    `
    SELECT p.*, c.profile_name
    FROM payments p
    LEFT JOIN creators c ON LOWER(p.creator)=LOWER(c.username)
    ORDER BY datetime(p.created_at) DESC
    LIMIT ?
    `,
    limit
  );

  return dedupePayments(rows);
}

async function getPaymentsByCreator(username, limit = 100) {
  const db = await dbPromise;
  const u = norm(username);

  const rows = await db.all(
    `
    SELECT p.*, c.profile_name
    FROM payments p
    LEFT JOIN creators c ON LOWER(p.creator)=LOWER(c.username)
    WHERE LOWER(p.creator)=LOWER(?)
    ORDER BY datetime(p.created_at) DESC
    LIMIT ?
    `,
    u,
    limit
  );

  return dedupePayments(rows);
}

async function getCreatorPayments(username) {
  const db = await dbPromise;
  const u = norm(username);

  const rows = await db.all(
    `
    SELECT p.*, c.profile_name
    FROM payments p
    LEFT JOIN creators c ON LOWER(p.creator)=LOWER(c.username)
    WHERE LOWER(p.creator)=LOWER(?)
    ORDER BY datetime(p.created_at) DESC
    `,
    u
  );

  return dedupePayments(rows);
}

// ---------- Creators ----------
async function getCreatorByUsername(username) {
  const db = await dbPromise;
  const u = norm(username);

  return db.get(
    `SELECT * FROM creators WHERE LOWER(username)=LOWER(?)`,
    u
  );
}

async function getCreatorProfile(username) {
  return getCreatorByUsername(username);
}

async function saveCreatorProfile(profile) {
  const db = await dbPromise;
  const u = norm(profile.username);

  return db.run(
    `
    INSERT INTO creators (
      username, profile_name, bio, avatar_url, social_links,
      theme_start, theme_mid, theme_end,
      milestone_enabled, milestone_amount, milestone_text,
      updated_at, email, password_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      updated_at = excluded.updated_at
    `,
    u,
    profile.profile_name ?? "",
    profile.bio ?? "",
    profile.avatar_url ?? "",
    profile.social_links ?? "[]",
    profile.theme_start ?? null,
    profile.theme_mid ?? null,
    profile.theme_end ?? null,
    profile.milestone_enabled ? 1 : 0,
    Number(profile.milestone_amount) || 0,
    profile.milestone_text ?? "",
    new Date().toISOString(),
    profile.email ?? null,
    profile.password_hash ?? null
  );
}

async function updateCreatorAvatarUrl(username, avatarUrl) {
  const db = await dbPromise;
  const u = norm(username);

  await db.run(
    `UPDATE creators SET avatar_url=?, updated_at=? WHERE LOWER(username)=LOWER(?)`,
    avatarUrl,
    new Date().toISOString(),
    u
  );

  return true;
}

async function updateCreatorThankYouVideo(username, videoUrl) {
  const db = await dbPromise;
  const u = norm(username);
  const cleanVideoUrl = norm(videoUrl);

  await db.run(
    `
    UPDATE creators
    SET thank_you_video=?, updated_at=?
    WHERE LOWER(username)=LOWER(?)
    `,
    cleanVideoUrl,
    new Date().toISOString(),
    u
  );

  return true;
}

async function updateCreatorUsername(oldUsername, newUsername) {
  const db = await dbPromise;

  return db.run(
    `
    UPDATE creators
    SET username=?, last_username_change=?
    WHERE LOWER(username)=LOWER(?)
    `,
    norm(newUsername),
    new Date().toISOString(),
    norm(oldUsername)
  );
}

// ---------- Auth ----------
async function findCreatorByEmail(email) {
  const db = await dbPromise;
  const cleanEmail = norm(email).toLowerCase();

  return db.get(
    `SELECT * FROM creators WHERE LOWER(email)=?`,
    cleanEmail
  );
}

async function createCreatorWithPassword({
  username,
  email,
  password,
  display_name,
}) {
  const db = await dbPromise;

  const cleanUsername = norm(username).toLowerCase();
  const cleanEmail = norm(email).toLowerCase();

  if (!cleanUsername || !cleanEmail || !password) {
    throw new Error("Missing required fields");
  }

  const passwordHash = bcrypt.hashSync(String(password), SALT_ROUNDS);

  await db.run(
    `
    INSERT INTO creators (
      username,
      profile_name,
      email,
      password_hash,
      theme_start,
      theme_mid,
      theme_end,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    cleanUsername,
    display_name || cleanUsername,
    cleanEmail,
    passwordHash,
    "#0B0D12",
    "#121826",
    "#0B0D12",
    new Date().toISOString()
  );

  return getCreatorByUsername(cleanUsername);
}

async function getCreatorById(id) {
  const db = await dbPromise;
  return db.get(`SELECT rowid, * FROM creators WHERE rowid=?`, id);
}

export {
  storePayment,
  getPayments,
  getPaymentsByCreator,
  getCreatorPayments,
  getCreatorByUsername,
  getCreatorProfile,
  saveCreatorProfile,
  updateCreatorAvatarUrl,
  updateCreatorThankYouVideo,
  updateCreatorUsername,
  findCreatorByEmail,
  createCreatorWithPassword,
  getCreatorById,
};

export default dbPromise;
