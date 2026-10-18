"use strict";

/**
 * Minimal HS256 JWT implementation on top of node:crypto.
 * Tokens carry: sub (user id or "admin"), role, tv (token version), iat, exp.
 * `tv` is compared against the user's tokenVersion on every check → instant
 * global revocation without a denylist.
 */

const crypto = require("crypto");
const config = require("../config");

const SECRET = Buffer.from(config.licenseSecret, "utf8");
const ALGO = "sha256";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload, { expiresInSeconds = config.security.tokenTtlDays * 86400 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${header}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac(ALGO, SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, data, sig] = parts;
  const expected = crypto.createHmac(ALGO, SECRET).update(`${header}.${data}`).digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function issueUserToken(user) {
  return sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion });
}

function issueAdminToken() {
  return sign({ sub: "admin", role: "admin", tv: 0 });
}

module.exports = { sign, verify, issueUserToken, issueAdminToken };
