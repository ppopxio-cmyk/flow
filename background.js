"use strict";

/* ============================================================================
 * Unlock Flow — background service worker (the gate).
 *
 * The patch script is ONLY registered while the account has access.
 * Access is re-checked every 15 minutes, on browser start, and whenever the
 * popup asks. Revocation / expiry / sign-out → script unregistered instantly.
 * ==========================================================================*/

// ⚠️ REPLACE with your real Render service URL (must match manifest host_permissions)
const API_BASE = "https://flow-1s6z.onrender.com";

const SCRIPT_ID = "unlock-flow-patch";
const ORIGIN = "https://flow.google.com/";
const ALARM_NAME = "uf-access-check";
const ALARM_PERIOD_MINUTES = 15;

const REGISTRATION = {
  id: SCRIPT_ID,
  matches: [ORIGIN + "*"],
  js: ["patch.js"],
  runAt: "document_start",
  world: "MAIN",
  persistAcrossSessions: true
};

/* ------------------------------------------------------------- script gate */

async function setScriptEnabled(enabled) {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (enabled && existing.length === 0) {
      await chrome.scripting.registerContentScripts([REGISTRATION]);
      console.log("[Unlock Flow] Patch registered (access granted).");
    } else if (!enabled && existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      console.log("[Unlock Flow] Patch unregistered (no access).");
    }
  } catch (err) {
    console.error("[Unlock Flow] Script gate error:", err);
  }
}

/* ------------------------------------------------------------ access sync */

async function syncAccess() {
  const { token, userEnabled } = await chrome.storage.local.get(["token", "userEnabled"]);

  if (!token) {
    await setScriptEnabled(false);
    const state = { signedIn: false, access: false, reason: "signed-out", checkedAt: Date.now() };
    await chrome.storage.local.set({ gate: state });
    return state;
  }

  let status, data;
  try {
    const res = await fetch(`${API_BASE}/api/v1/access/check`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    status = res.status;
    try { data = await res.json(); } catch { data = null; }
  } catch {
    // Offline / Render cold-start: keep last known state, do NOT lock.
    const { gate } = await chrome.storage.local.get("gate");
    return gate || { signedIn: true, access: false, reason: "offline", checkedAt: Date.now() };
  }

  if (status === 401 || status === 403) {
    await chrome.storage.local.remove("token");
    await setScriptEnabled(false);
    const state = { signedIn: false, access: false, reason: "session-expired", checkedAt: Date.now() };
    await chrome.storage.local.set({ gate: state });
    return state;
  }

  if (status !== 200 || !data) {
    const { gate } = await chrome.storage.local.get("gate");
    return gate || { signedIn: true, access: false, reason: "offline", checkedAt: Date.now() };
  }

  const access = Boolean(data.access);
  const enabled = access && userEnabled !== false;
  await setScriptEnabled(enabled);

  const state = {
    signedIn: true,
    access,
    enabled,
    reason: data.reason,
    role: data.role,
    trialEndsAt: data.trialEndsAt,
    paidThrough: data.paidThrough,
    checkedAt: Date.now()
  };
  await chrome.storage.local.set({ gate: state });
  return state;
}

/* ------------------------------------------------------------------ alarms */

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  syncAccess();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  syncAccess();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) syncAccess();
});

/* ---------------------------------------------------------------- messages */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && message.type;

  if (type === "uf:sync") {
    syncAccess().then(sendResponse);
    return true; // async
  }

  if (type === "uf:state") {
    chrome.storage.local.get(["gate", "token", "userEnabled"]).then(sendResponse);
    return true;
  }

  if (type === "uf:setUserEnabled") {
    chrome.storage.local.set({ userEnabled: message.enabled !== false }).then(syncAccess).then(sendResponse);
    return true;
  }

  if (type === "uf:signOut") {
    chrome.storage.local.remove(["token", "gate"]).then(async () => {
      await setScriptEnabled(false);
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
