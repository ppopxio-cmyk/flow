"use strict";

const express = require("express");
const config = require("../config");
const Receipt = require("../models/Receipt");
const { limiters, requireAuth, requireAnyAuth } = require("../middleware/auth");
const { publicUser } = require("./auth");

const router = express.Router();

/* --------------------------------------------------- public app configuration */

router.get("/config", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    trialHours: config.trialHours,
    plan: {
      priceEtb: config.plan.priceEtb,
      days: config.plan.days,
      holderName: config.plan.holderName,
      telebirrNumber: config.plan.telebirrNumber,
      abyssiniaNumber: config.plan.abyssiniaNumber
    }
  });
});

/* -------------------------------------------------------------- access check */

router.get("/access/check", limiters.check, requireAnyAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.auth.role === "admin") {
    return res.json({
      access: true,
      reason: "admin",
      role: "admin",
      trialEndsAt: null,
      paidThrough: null,
      now: Date.now()
    });
  }
  const access = req.user.accessInfo();
  res.json({
    access: access.access,
    reason: access.reason,
    role: req.user.role,
    trialEndsAt: access.trialEndsAt,
    paidThrough: access.paidThrough,
    now: Date.now()
  });
});

/* ----------------------------------------------------------------- receipts */

router.get("/receipts", requireAuth, async (req, res, next) => {
  try {
    const receipts = await Receipt.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("url method amountEtb status adminNote createdAt resolvedAt")
      .lean();
    res.json({ receipts });
  } catch (err) {
    next(err);
  }
});

router.post("/receipts", limiters.auth, requireAuth, async (req, res, next) => {
  try {
    const url = String(req.body?.url || "").trim();
    const method = String(req.body?.method || "").trim();

    if (!["telebirr", "abyssinia"].includes(method)) {
      return res.status(422).json({ error: "Choose Telebirr or Bank of Abyssinia." });
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(422).json({ error: "Paste a valid receipt link (https://…)." });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(422).json({ error: "Receipt links must start with http:// or https://." });
    }

    const pending = await Receipt.findOne({ userId: req.user._id, status: "pending" });
    if (pending) {
      return res.status(409).json({ error: "You already have a receipt waiting for review." });
    }

    const receipt = await Receipt.create({
      userId: req.user._id,
      email: req.user.email,
      url,
      method,
      amountEtb: config.plan.priceEtb
    });

    res.status(201).json({
      ok: true,
      receipt: {
        id: receipt._id,
        url: receipt.url,
        method: receipt.method,
        status: receipt.status,
        createdAt: receipt.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------- user profile */

router.get("/plan", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
