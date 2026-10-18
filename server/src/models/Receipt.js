"use strict";

const mongoose = require("mongoose");

const receiptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    method: { type: String, enum: ["telebirr", "abyssinia"], required: true },
    amountEtb: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },
    adminNote: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: "" }
  },
  { timestamps: true }
);

receiptSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("Receipt", receiptSchema);
