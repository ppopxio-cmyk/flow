"use strict";

const express = require("express");
const helmet = require("helmet");
const config = require("./config");
const { limiters } = require("./middleware/auth");
const { router: authRoutes } = require("./routes/auth");
const userRoutes = require("./routes/user");
const adminRoutes = require("./routes/admin");

const app = express();

app.set("trust proxy", 1); // Render sits behind a proxy — needed for correct rate-limit keys
app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false // pure JSON API — no HTML to protect
  })
);

// Extension pages send Authorization headers → allow CORS for the API.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.set("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "32kb" }));
app.use(limiters.global);

app.get("/health", (req, res) => res.json({ ok: true, service: "unlock-flow-api" }));

app.use("/api/v1", authRoutes);
app.use("/api/v1", userRoutes);
app.use("/api/v1/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[error]", err.message);
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large." });
  }
  res.status(500).json({ error: "Something went wrong. Try again." });
});

module.exports = app;
