# Unlock Flow — API Server

Pure JSON API (Express + MongoDB Atlas) that gates the Unlock Flow extension:
email/password auth with 6-digit Gmail verification codes, trial + subscription
access checks, manual receipt approval, and an admin queue.

## Run locally

```bash
cd server
npm install
npm run dev        # nodemon, port 3000
```

Env is read from `server/.env` first, then the repo-root `.env`.
Copy `.env.example` if you don't have one. In development (`NODE_ENV!=production`)
the auth endpoints return a `devCode` field and the extension auto-fills it —
no email reading needed while testing. Production never returns it.

`MONGO_URI` needs no database name — `/unlockflow` is appended automatically.

## Deploy on Render

1. Create a **Web Service** → point it at this repo, root directory `server/`.
   - Build command: `npm install`
   - Start command: `npm start`
   - (or commit `render.yaml` and let Render pick it up)
2. In **Environment**, set every variable from `.env.example`:
   `MONGO_URI`, `LICENSE_SECRET`, `MAIL_USER`, `MAIL_APP_PASSWORD`, `MAIL_FROM_NAME`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `TRIAL_HOURS`, `PLAN_PRICE_ETB`, `PLAN_DAYS`,
   `HOLDER_NAME`, `TELEBIRR_NUMBER`, `ABYSSINIA_NUMBER`, `APP_URL`, `API_URL`
   (with `API_URL` = the service URL Render gives you, e.g. `https://unlock-flow-api.onrender.com`).
3. MongoDB Atlas → Network Access → allow `0.0.0.0/0` (Render IPs change) or use
   a less restrictive rule.
4. **After you know the final URL, update it in the extension** (3 spots):
   - `manifest.json` → `host_permissions`
   - `background.js` → `API_BASE`
   - `popup.js` → `API_BASE`
   Then reload the extension in `chrome://extensions`.

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| GET | `/api/v1/config` | — | trial hours + payment instructions |
| POST | `/api/v1/auth/signup` | — | Gmail-only signup, emails a 6-digit code |
| POST | `/api/v1/auth/verify` | — | verify code → `{ token, user }`, starts trial |
| POST | `/api/v1/auth/resend` | — | resend code (60s cooldown) |
| POST | `/api/v1/auth/login` | — | email+password → token (env-credential admin also logs in here) |
| GET | `/api/v1/me` | Bearer | profile |
| GET | `/api/v1/access/check` | Bearer | `{ access, reason, trialEndsAt, paidThrough }` |
| GET | `/api/v1/receipts` | Bearer | own submission history |
| POST | `/api/v1/receipts` | Bearer | submit receipt link (one pending at a time) |
| GET | `/api/v1/admin/stats` | Admin | counts |
| GET | `/api/v1/admin/receipts?status=` | Admin | queue |
| POST | `/api/v1/admin/receipts/:id/resolve` | Admin | `approve` (+30d) / `reject` |
| GET | `/api/v1/admin/users?search=` | Admin | user list |
| POST | `/api/v1/admin/users/:id/extend` | Admin | add days |
| POST | `/api/v1/admin/users/:id/revoke` | Admin | kill access + all tokens instantly |

Access rule (strict): `now < trialEndsAt || now < paidThrough`. Pending receipts
grant nothing until approved. Revocation bumps `tokenVersion`, which kills every
outstanding token on its next check.

## Security notes

- **Rotate every secret** that was ever pasted into a chat (Atlas password, Gmail
  app password, `LICENSE_SECRET`) — treat them as compromised.
- Never commit `.env` (already in `.gitignore`).
- Codes are stored hashed (SHA-256), expire in 10 min, max 5 attempts.
- Passwords: bcrypt (12 rounds). Login: 8-failure / 15-min lockout.
- All auth endpoints are rate-limited; admin has no website — it lives in the extension.
