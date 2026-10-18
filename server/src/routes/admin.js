"use strict";

const express = require("express");
const config = require("../config");
const User = require("../models/User");
const Receipt = require("../models/Receipt");
const mail = require("../services/mail");
const { limiters, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(limiters.admin, requireAdmin);

const DAY_MS = 86400 * 1000;

/* ------------------------------------------------------------------- stats */

router.get("/stats", async (req, res, next) => {
  try {
    const now = new Date();
    const [pending, totalUsers, activeSubs, activeTrials] = await Promise.all([
      Receipt.countDocuments({ status: "pending" }),
      User.countDocuments({}),
      User.countDocuments({ paidThrough: { $gt: now } }),
      User.countDocuments({ trialEndsAt: { $gt: now }, paidThrough: null })
    ]);
    res.json({ pending, totalUsers, activeSubs, activeTrials });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ queue */

router.get("/receipts", async (req, res, next) => {
  try {
    const status = ["pending", "approved", "rejected"].includes(req.query.status)
      ? req.query.status
      : "pending";
    const receipts = await Receipt.find({ status })
      .sort({ createdAt: status === "pending" ? 1 : -1 })
      .limit(100)
      .lean();
    res.json({ receipts });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------- approve / reject */

router.post("/receipts/:id/resolve", async (req, res, next) => {
  try {
    const action = String(req.body?.action || "");
    const note = String(req.body?.note || "").slice(0, 300);
    const receipt = await Receipt.findById(req.params.id);
    if (!receipt) return res.status(404).json({ error: "Receipt not found." });
    if (receipt.status !== "pending") {
      return res.status(409).json({ error: `Already ${receipt.status}.` });
    }

    const user = await User.findById(receipt.userId);

    if (action === "approve") {
      const now = Date.now();
      const base = user?.paidThrough && user.paidThrough.getTime() > now
        ? user.paidThrough.getTime()
        : now;
      const paidThrough = new Date(base + config.plan.days * DAY_MS);

      receipt.status = "approved";
      receipt.adminNote = note;
      receipt.resolvedAt = new Date();
      receipt.resolvedBy = req.admin.sub;
      await receipt.save();

      if (user) {
        user.paidThrough = paidThrough;
        await user.save();
        await mail.sendApprovedEmail(user.email, paidThrough).catch(err =>
          console.warn("[mail] approve notice failed:", err.message)
        );
      }
      return res.json({ ok: true, status: "approved", paidThrough });
    }

    if (action === "reject") {
      receipt.status = "rejected";
      receipt.adminNote = note;
      receipt.resolvedAt = new Date();
      receipt.resolvedBy = req.admin.sub;
      await receipt.save();

      if (user) {
        await mail.sendRejectedEmail(user.email, note).catch(err =>
          console.warn("[mail] reject notice failed:", err.message)
        );
      }
      return res.json({ ok: true, status: "rejected" });
    }

    res.status(422).json({ error: "action must be 'approve' or 'reject'." });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ users */

router.get("/users", async (req, res, next) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const filter = search ? { email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } } : {};
    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .select("email role trialEndsAt paidThrough createdAt lastLoginAt")
      .lean();

    const now = Date.now();
    res.json({
      users: users.map(u => ({
        id: u._id,
        email: u.email,
        role: u.role,
        trialEndsAt: u.trialEndsAt,
        paidThrough: u.paidThrough,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        active: Boolean((u.paidThrough && u.paidThrough.getTime() > now) ||
          (u.trialEndsAt && u.trialEndsAt.getTime() > now))
      }))
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------- extend and revoke */

router.post("/users/:id/extend", async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.body?.days) || config.plan.days));
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    const now = Date.now();
    const base = user.paidThrough && user.paidThrough.getTime() > now
      ? user.paidThrough.getTime()
      : now;
    user.paidThrough = new Date(base + days * DAY_MS);
    await user.save();

    res.json({ ok: true, paidThrough: user.paidThrough });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/revoke", async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    user.paidThrough = new Date(0);
    user.trialEndsAt = new Date(0);
    user.tokenVersion += 1; // kills every outstanding token instantly
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
