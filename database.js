import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

// Render-safe persistent DB location
const DB_PATH = process.env.RENDER ? "/data/everpay.db" : "everpay.db";

const dbPromise = open({
  filename: DB_PATH,
  driver: sqlite3.Database
});

// ---------- INIT ----------
async function init() {
  const db = await dbPromise;

  // ---------- Creators table ----------
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

  // ---------- Payments table ----------
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
}

init();

// ---------- Store a payment ----------
async function storePayment(payment) {
  const db = await dbPromise;
  return db.run(
    `
    INSERT OR REPLACE INTO payments (
      id, amount, email, creator, status, created_at,
      gift_name, anonymous, gift_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    payment.id,
    payment.amount,
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
  return db.all(
    `
    SELECT p.*, c.profile_name
    FROM payments p
    LEFT JOIN creators c ON p.creator = c.username
    ORDER BY datetime(p.created_at) DESC
    LIMIT ?
    `,
    limit
  );
}

async function getPaymentsByCreator(username, limit = 100) {
  const db = await dbPromise;
  return db.all(
    `
    SELECT p.*, c.profile_name
    FROM payments p
    LEFT JOIN creators c ON p.creator = c.username
    WHERE p.creator = ?
    ORDER BY datetime(p.created_at) DESC
    LIMIT ?
    `,
    username,
    limit
  );
}

async function getCreatorPayments(username) {
  const db = await dbPromise;
  return db.all(
    `
    SELECT p.*, c.profile_name
    FROM payments p
    LEFT JOIN creators c ON p.creator = c.username
    WHERE p.creator = ?
    ORDER BY datetime(p.created_at) DESC
    `,
    username
  );
}

// ---------- Creators ----------
async function getCreatorByUsername(username) {
  const db = await dbPromise;
  return db.get(`SELECT * FROM creators WHERE username = ?`, username);
}

async function getCreatorProfile(username) {
  return getCreatorByUsername(username);
}

async function saveCreatorProfile(profile) {
  const db = await dbPromise;
  return db.run(
    `
    INSERT OR REPLACE INTO creators (
      username, profile_name, bio, avatar_url, social_links,
      theme_start, theme_mid, theme_end, updated_at,
      email, password_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    profile.username,
    profile.profile_name,
    profile.bio,
    profile.avatar_url,
    profile.social_links,
    profile.theme_start,
    profile.theme_mid,
    profile.theme_end,
    new Date().toISOString(),
    profile.email,
    profile.password_hash
  );
}

async function updateCreatorUsername(oldUsername, newUsername) {
  const db = await dbPromise;
  return db.run(
    `
    UPDATE creators
    SET username = ?, last_username_change = ?
    WHERE username = ?
    `,
    newUsername,
    new Date().toISOString(),
    oldUsername
  );
}

// ---------- Auth ----------
async function findCreatorByEmail(email) {
  const db = await dbPromise;
  return db.get(`SELECT * FROM creators WHERE email = ?`, email);
}

async function createCreatorWithPassword({ username, email, password, display_name }) {
  const db = await dbPromise;
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

  await db.run(
    `
    INSERT INTO creators (
      username, profile_name, email, password_hash
    ) VALUES (?, ?, ?, ?)
    `,
    username,
    display_name,
    email,
    passwordHash
  );

  return findCreatorByEmail(email);
}

async function getCreatorById(id) {
  const db = await dbPromise;
  return db.get(`SELECT rowid, * FROM creators WHERE rowid = ?`, id);
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

export default dbPromise;

