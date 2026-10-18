"use strict";

const SCRIPT_ID = "unlock-flow-patch";
const ORIGIN = "https://flow.google.com/";

const REGISTRATION = {
  id: SCRIPT_ID,
  matches: [ORIGIN + "*"],
  js: ["patch.js"],
  runAt: "document_start",
  world: "MAIN",
  persistAcrossSessions: true
};

async function ensureRegistered() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length === 0) {
      await chrome.scripting.registerContentScripts([REGISTRATION]);
      console.log("[Unlock Flow] Content script registered successfully.");
    }
  } catch (err) {
    console.error("[Unlock Flow] Registration error:", err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureRegistered();
});

chrome.runtime.onStartup.addListener(() => {
  ensureRegistered();
});