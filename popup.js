"use strict";

const ORIGIN = "https://flow.google.com/";
const SCRIPT_IDS = ["unlock-flow-patch", "flow-region-helper-v1"];
const PRIMARY_SCRIPT_ID = "unlock-flow-patch";

const toggle = document.getElementById("enabled");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const openBtn = document.getElementById("open");
const reloadBtn = document.getElementById("reload");

let isBusy = false;

async function getFlowTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.startsWith(ORIGIN)) return active;
  const tabs = await chrome.tabs.query({ url: ORIGIN + "*", currentWindow: true });
  return tabs[0];
}

function setStatus(text, isError = false) {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? "#d64545" : "#0097a7";
  }
}

async function updateStatus() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
    const enabled = scripts.length > 0;
    toggle.checked = enabled;
    toggle.disabled = false;

    if (!enabled) {
      setStatus("ပိတ်ထားပါသည် (Disabled)");
      return;
    }

    const tab = await getFlowTab();
    if (!tab) {
      setStatus("ဖွင့်ထားပါသည် (Flow စာမျက်နှာကို ဖွင့်ပါ)");
      return;
    }

    let snapshot;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => {
          const v = window.__flowRegionHelper_v1 || window.__unlockFlow_v1 || window.__flowLocalDiagnostic;
          return v ? { state: v.state, changed: v.changed, detail: v.detail } : null;
        }
      });
      snapshot = results[0]?.result;
    } catch {
      setStatus("ဖွင့်ထားပါသည် (Reload လုပ်ရန် လိုအပ်ပါသည်)");
      return;
    }

    const stateMap = {
      waiting: "ချိတ်ဆက်မှု စောင့်ဆိုင်းနေသည် (Waiting for config)",
      patched: "ဒေသကျော်ခြင်း အောင်မြင်ပါသည် (Local patch applied)",
      "already-allowed": "မူလအတိုင်း ရရှိနေသည် (Flag already enabled)",
      "schema-mismatch": "Flow ပုံစံပြောင်းလဲသွားပါသည် (Response changed)",
      "server-error": "ဆာဗာမှ ငြင်းပယ်ပါသည် (Server rejected: " + (snapshot?.detail || "") + ")",
      "read-error": "အချက်အလက် ဖတ်မရပါ (Response unavailable)"
    };

    const msg = stateMap[snapshot?.state] || "ဖွင့်ထားပါသည် (Flow စာမျက်နှာ Reload လုပ်ပါ)";
    setStatus(msg);
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || String(err);
  }
}

async function openFlow(createIfMissing = true) {
  const tab = await getFlowTab();
  if (!tab) {
    if (createIfMissing) {
      await chrome.tabs.create({ url: ORIGIN });
    }
    return;
  }
  try {
    const url = new URL(tab.url);
    if (url.pathname.replace(/\/$/, "") === "/unsupported-country") {
      await chrome.tabs.update(tab.id, { url: ORIGIN, active: true });
    } else {
      await chrome.tabs.reload(tab.id);
      await chrome.tabs.update(tab.id, { active: true });
    }
  } catch {
    await chrome.tabs.reload(tab.id);
  }
}

async function runAction(fn) {
  if (isBusy) return;
  isBusy = true;
  const buttons = [openBtn, reloadBtn, toggle].filter(Boolean);
  buttons.forEach(b => { b.disabled = true; });
  if (errorEl) errorEl.textContent = "";

  try {
    await fn();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || String(err);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
    isBusy = false;
  }
}

toggle.addEventListener("change", () => runAction(async () => {
  const next = toggle.checked;

  // Clean up any registered content scripts under our recognized IDs
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: existing.map(s => s.id) });
  }

  if (next) {
    await chrome.scripting.registerContentScripts([{
      id: PRIMARY_SCRIPT_ID,
      matches: [ORIGIN + "*"],
      js: ["patch.js"],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true
    }]);
  }

  await updateStatus();
  await openFlow(next);
}));

if (openBtn) {
  openBtn.addEventListener("click", () => runAction(() => openFlow(true)));
}

if (reloadBtn) {
  reloadBtn.addEventListener("click", () => runAction(async () => {
    await openFlow(false);
    await updateStatus();
  }));
}

// Initial status check
runAction(updateStatus);