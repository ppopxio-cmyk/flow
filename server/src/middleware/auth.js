"use strict";

const { rateLimit } = require("express-rate-limit");
const config = require("../config");
const tokenService = require("../services/token");
const User = require("../models/User");

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit: config.isProd ? limit : limit * 10, // local testing convenience
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message }
  });
}

const limiters = {
  // Global safety net
  global: limiter({ windowMs: 15 * 60 * 1000, limit: 600, message: "Too many requests." }),
  // Signup / login / resend
  auth: limiter({ windowMs: 15 * 60 * 1000, limit: 12, message: "Too many attempts. Try again in a few minutes." }),
  // Code verification attempts
  verify: limiter({ windowMs: 15 * 60 * 1000, limit: 25, message: "Too many code attempts." }),
  // Access checks (extension polls this)
  check: limiter({ windowMs: 60 * 1000, limit: 45, message: "Rate limited." }),
  // Admin browsing
  admin: limiter({ windowMs: 60 * 1000, limit: 120, message: "Rate limited." })
};

async function requireAuth(req, res, next) {
  try {
    const raw = bearer(req);
    if (!raw) return res.status(401).json({ error: "Not signed in." });

    const payload = tokenService.verify(raw);
    if (!payload || payload.role === "admin") {
      return res.status(401).json({ error: "Session expired. Sign in again." });
    }

    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: "Account not found." });
    if (user.tokenVersion !== payload.tv) {
      return res.status(401).json({ error: "Session revoked. Sign in again." });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Accepts user tokens (loads req.user) AND admin tokens (req.auth.role === "admin"). */
async function requireAnyAuth(req, res, next) {
  try {
    const raw = bearer(req);
    if (!raw) return res.status(401).json({ error: "Not signed in." });

    const payload = tokenService.verify(raw);
    if (!payload) return res.status(401).json({ error: "Session expired. Sign in again." });

    if (payload.role === "admin") {
      req.auth = payload;
      return next();
    }

    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: "Account not found." });
    if (user.tokenVersion !== payload.tv) {
      return res.status(401).json({ error: "Session revoked. Sign in again." });
    }

    req.user = user;
    req.auth = { role: "user" };
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  const raw = bearer(req);
  const payload = raw ? tokenService.verify(raw) : null;
  if (!payload || payload.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  req.admin = payload;
  next();
}

module.exports = { limiters, requireAuth, requireAnyAuth, requireAdmin };
