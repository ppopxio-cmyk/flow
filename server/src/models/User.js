"use strict";

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    passwordHash: { type: String, required: true },

    // Access windows -------------------------------------------------------
    trialEndsAt: { type: Date, default: null },
    paidThrough: { type: Date, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },

    // Revocation: any token whose `tv` is older than this is dead instantly.
    tokenVersion: { type: Number, default: 0 },

    // Email verification code (stored hashed) ------------------------------
    codeHash: { type: String, default: null },
    codeExpiresAt: { type: Date, default: null },
    codeAttempts: { type: Number, default: 0 },
    codeSentAt: { type: Date, default: null },

    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

/**
 * Strict access rule: an active trial OR an active subscription.
 * A pending receipt deliberately grants nothing.
 */
userSchema.methods.accessInfo = function accessInfo(now = new Date()) {
  const trialEndsAt = this.trialEndsAt ? this.trialEndsAt.getTime() : null;
  const paidThrough = this.paidThrough ? this.paidThrough.getTime() : null;

  if (paidThrough && paidThrough > now.getTime()) {
    return { access: true, reason: "active", trialEndsAt, paidThrough };
  }
  if (trialEndsAt && trialEndsAt > now.getTime()) {
    return { access: true, reason: "trial", trialEndsAt, paidThrough };
  }
  if (!trialEndsAt && !paidThrough) {
    return { access: false, reason: "unverified", trialEndsAt, paidThrough };
  }
  if (trialEndsAt && !paidThrough) {
    return { access: false, reason: "trial-expired", trialEndsAt, paidThrough };
  }
  return { access: false, reason: "subscription-expired", trialEndsAt, paidThrough };
};

userSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    email: this.email,
    role: this.role,
    trialEndsAt: this.trialEndsAt,
    paidThrough: this.paidThrough,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model("User", userSchema);
