"use strict";

const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const config = require("../config");
const User = require("../models/User");
const mail = require("../services/mail");
const tokenService = require("../services/token");
const { limiters, requireAnyAuth } = require("../middleware/auth");

const router = express.Router();

const GMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/i;
const DEV = !config.isProd;

// In-memory lockout counters (per email). Fine for a single-instance API.
const loginFailures = new Map();

function failKey(email) {
  return email.toLowerCase();
}

function recordFailure(email) {
  const key = failKey(email);
  const entry = loginFailures.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= config.security.maxLoginFailures) {
    entry.until = Date.now() + config.security.loginLockoutMinutes * 60 * 1000;
    entry.count = 0;
  }
  loginFailures.set(key, entry);
}

function isLockedOut(email) {
  const entry = loginFailures.get(failKey(email));
  return Boolean(entry && entry.until > Date.now());
}

function clearFailures(email) {
  loginFailures.delete(failKey(email));
}

function makeCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function publicUser(user) {
  const access = user.accessInfo();
  return {
    email: user.email,
    role: user.role,
    trialEndsAt: access.trialEndsAt,
    paidThrough: access.paidThrough,
    access: access.access,
    reason: access.reason
  };
}

/** Create or refresh the 6-digit code for an email. */
async function issueCode(user) {
  const code = makeCode();
  const now = new Date();
  user.codeHash = hashCode(code);
  user.codeExpiresAt = new Date(now.getTime() + config.security.codeTtlMinutes * 60 * 1000);
  user.codeAttempts = 0;
  user.codeSentAt = now;
  await user.save();
  try {
    await mail.sendVerificationCode(user.email, code);
  } catch (err) {
    console.warn("[mail] verification code failed:", err.message);
  }
  return code;
}

/* ------------------------------------------------------------------ signup */

router.post("/auth/signup", limiters.auth, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!GMAIL_RE.test(email)) {
      return res.status(422).json({ error: "Only Gmail addresses can sign up." });
    }
    if (password.length < 8) {
      return res.status(422).json({ error: "Password must be at least 8 characters." });
    }

    let user = await User.findOne({ email });

    if (user && user.passwordHash) {
      // Already registered — only truly unverified accounts may re-request codes.
      const verified = Boolean(user.trialEndsAt || user.paidThrough);
      if (verified) {
        return res.status(409).json({ error: "This email is already registered. Sign in instead." });
      }
      if (user.codeSentAt &&
          Date.now() - user.codeSentAt.getTime() < config.security.codeResendCooldownSeconds * 1000) {
        const wait = Math.ceil((config.security.codeResendCooldownSeconds * 1000 - (Date.now() - user.codeSentAt.getTime())) / 1000);
        return res.status(429).json({ error: `Code already sent. Wait ${wait}s to resend.` });
      }
      // New password on an unverified account = attempted account fix.
      user.passwordHash = await bcrypt.hash(password, 12);
    } else if (user) {
      // Legacy account without password — attach one.
      user.passwordHash = await bcrypt.hash(password, 12);
    } else {
      user = new User({ email, passwordHash: await bcrypt.hash(password, 12) });
    }

    const code = await issueCode(user);

    res.status(201).json({
      ok: true,
      email: user.email,
      ...(DEV ? { devCode: code } : {}) // auto-verify convenience in development
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------- verify */

router.post("/auth/verify", limiters.verify, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();

    if (!/^\d{6}$/.test(code)) {
      return res.status(422).json({ error: "Enter the 6-digit code." });
    }

    const user = await User.findOne({ email });
    if (!user || !user.codeHash) {
      return res.status(400).json({ error: "No code requested for this email." });
    }
    if (user.codeAttempts >= config.security.codeMaxAttempts) {
      return res.status(429).json({ error: "Too many wrong codes. Request a new one." });
    }
    if (!user.codeExpiresAt || user.codeExpiresAt.getTime() < Date.now()) {
      return res.status(410).json({ error: "That code expired. Request a new one." });
    }

    user.codeAttempts += 1;
    const given = hashCode(code);
    const match = given.length === user.codeHash.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(user.codeHash));

    if (!match) {
      await user.save();
      const left = config.security.codeMaxAttempts - user.codeAttempts;
      return res.status(400).json({ error: `Wrong code. ${left} attempt${left === 1 ? "" : "s"} left.` });
    }

    // Verified ✔
    user.codeHash = null;
    user.codeExpiresAt = null;
    user.codeAttempts = 0;
    user.codeSentAt = null;
    if (!user.trialEndsAt && !user.paidThrough) {
      user.trialEndsAt = new Date(Date.now() + config.trialHours * 3600 * 1000);
    }
    user.lastLoginAt = new Date();
    await user.save();

    res.json({ ok: true, token: tokenService.issueUserToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------- resend */

router.post("/auth/resend", limiters.auth, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ error: "Sign up first, then request the code." });
    }
    if (user.trialEndsAt || user.paidThrough) {
      return res.status(409).json({ error: "This email is already registered. Sign in instead." });
    }
    if (user.codeSentAt &&
        Date.now() - user.codeSentAt.getTime() < config.security.codeResendCooldownSeconds * 1000) {
      const wait = Math.ceil((config.security.codeResendCooldownSeconds * 1000 - (Date.now() - user.codeSentAt.getTime())) / 1000);
      return res.status(429).json({ error: `Wait ${wait}s before resending.` });
    }
    const code = await issueCode(user);
    res.json({ ok: true, ...(DEV ? { devCode: code } : {}) });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------- login */

router.post("/auth/login", limiters.auth, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(422).json({ error: "Email and password are required." });
    }

    // Environment-credential admin (no DB account needed).
    if (email === config.admin.email && password === config.admin.password) {
      clearFailures(email);
      return res.json({ ok: true, token: tokenService.issueAdminToken(), user: { email: config.admin.email, role: "admin" } });
    }

    if (isLockedOut(email)) {
      return res.status(429).json({ error: `Too many failed attempts. Locked for ${config.security.loginLockoutMinutes} minutes.` });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!ok) {
      recordFailure(email);
      return res.status(401).json({ error: "Wrong email or password." });
    }

    if (!user.codeHash && !user.trialEndsAt && !user.paidThrough) {
      // Registered but never completed verification.
      const code = await issueCode(user);
      return res.status(409).json({
        error: "Email not verified yet.",
        needsVerification: true,
        email: user.email,
        ...(DEV ? { devCode: code } : {})
      });
    }

    clearFailures(email);
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ ok: true, token: tokenService.issueUserToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------------------- me */

router.get("/me", requireAnyAuth, (req, res) => {
  if (req.auth.role === "admin") {
    return res.json({ user: { email: config.admin.email, role: "admin" } });
  }
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, publicUser };
