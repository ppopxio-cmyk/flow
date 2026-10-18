"use strict";

const mongoose = require("mongoose");
const config = require("./config");
const app = require("./app");

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log("[db] connected to MongoDB Atlas");

  const server = app.listen(config.port, () => {
    console.log(`[api] Unlock Flow API listening on :${config.port} (${config.env})`);
  });

  const shutdown = async signal => {
    console.log(`\n[api] ${signal} — shutting down`);
    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(err => {
  console.error("[fatal]", err);
  process.exit(1);
});
