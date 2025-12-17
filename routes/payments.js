import express from "express";
import { getPayments, getPaymentsByCreator } from "../database.js";

const router = express.Router();

// MAIN EverPay dashboard — all payments
router.get("/", (req, res) => {
  try {
    const list = getPayments().filter(p => !p.creator || p.creator === "");
    res.json(list);
  } catch (err) {
    console.error("❌ Error loading payments:", err);
    res.status(500).json({ error: "Failed to load payments" });
  }
});

// CREATOR public page — payments for a specific creator
router.get("/creator/:username", (req, res) => {
  try {
    const { username } = req.params;
    const payments = getPaymentsByCreator(username);
    res.json(payments);
  } catch (error) {
    console.error("⚠️ Failed to get creator payments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
