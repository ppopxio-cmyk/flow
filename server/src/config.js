"use strict";

/**
 * Central config — reads .env (server/.env first, then repo-root .env as fallback)
 * and validates that everything the API needs is present.
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const serverEnv = path.join(__dirname, "..", ".env");
const rootEnv = path.join(__dirname, "..", "..", ".env");

// override:true → the .env file is the source of truth (a stale shell env can't
// shadow it). On Render there is no .env file, so dashboard env vars stay as-is.
if (fs.existsSync(serverEnv)) dotenv.config({ path: serverEnv, override: true });
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: true });

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Ensure the Mongo connection string points at a database (e.g. /unlockflow). */
function withDbName(uri) {
  try {
    const parsed = new URL(uri);
    if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/unlockflow";
    return parsed.toString();
  } catch {
    return uri;
  }
}

const config = {
  env: process.env.NODE_ENV || "development",
  isProd: (process.env.NODE_ENV || "development") === "production",
  port: number("PORT", 3000),
  appUrl: process.env.APP_URL || "http://localhost:3000",
  apiBase: process.env.API_URL || "http://localhost:3000",

  mongoUri: withDbName(required("MONGO_URI")),
  licenseSecret: required("LICENSE_SECRET"),

  mail: {
    user: required("MAIL_USER"),
    pass: required("MAIL_APP_PASSWORD"),
    fromName: process.env.MAIL_FROM_NAME || "Unlock Flow"
  },

  admin: {
    email: required("ADMIN_EMAIL"),
    password: required("ADMIN_PASSWORD")
  },

  trialHours: number("TRIAL_HOURS", 2),
  plan: {
    priceEtb: number("PLAN_PRICE_ETB", 500),
    days: number("PLAN_DAYS", 30),
    holderName: process.env.HOLDER_NAME || "Hailemichael Shitaye",
    telebirrNumber: process.env.TELEBIRR_NUMBER || "",
    abyssiniaNumber: process.env.ABYSSINIA_NUMBER || ""
  },

  security: {
    tokenTtlDays: 30,
    codeTtlMinutes: 10,
    codeResendCooldownSeconds: 60,
    codeMaxAttempts: 5,
    maxLoginFailures: 8,
    loginLockoutMinutes: 15
  }
};

module.exports = config;
