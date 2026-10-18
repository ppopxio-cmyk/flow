"use strict";

/* ============================================================================
 * Unlock Flow — popup app (status · login · signup · verify · account · admin)
 * ==========================================================================*/

// ⚠️ REPLACE with your real Render service URL (must match manifest host_permissions)
const API_BASE = "https://unlock-flow-api.onrender.com";

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const state = {
  token: null,
  gate: null,
  config: null,
  codeEmail: "",
  countdownTimer: null,
  resendTimer: null,
  adminTab: "pending"
};

/* ---------------------------------------------------------------- helpers */

function toast(message, ms = 2400) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

function showErr(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function clearErr(el) {
  el.hidden = true;
  el.textContent = "";
}

function busy(button, on, label) {
  if (!button) return;
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = label || "Please wait…";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // Render cold start
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Server error (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Server is waking up — try again in a few seconds.");
    }
    if (err instanceof TypeError) {
      throw new Error("Can't reach the server. Check your connection.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------ screen router */

function go(screen) {
  document.body.dataset.screen = screen;
  $$(".screen").forEach(s => { s.hidden = s.dataset.screen !== screen; });
  stopCountdown();
  if (screen === "status") { renderStatus(); startCountdown(); }
  if (screen === "dashboard") loadDashboard();
  if (screen === "admin") loadAdmin();
}

$$("[data-back]").forEach(btn =>
  btn.addEventListener("click", () => go(btn.dataset.back || "status"))
);

/* ============================================================================
 * STATUS SCREEN
 * ==========================================================================*/

const MESSAGES = {
  "signed-out": {
    icon: "🔒", cls: "bad", title: "You're signed out",
    sub: "Sign in to start your free trial and unlock Flow."
  },
  "session-expired": {
    icon: "🔑", cls: "warn", title: "Session expired",
    sub: "Please sign in again to confirm it's you."
  },
  offline: {
    icon: "🌐", cls: "", title: "Can't reach the server",
    sub: "Check your internet connection and tap Refresh."
  },
  unverified: {
    icon: "✉️", cls: "warn", title: "Verify your email",
    sub: "Enter the 6-digit code we emailed you."
  },
  "trial-expired": {
    icon: "⏳", cls: "warn", title: "Trial ended",
    sub: "Subscribe for 500 ETB / 30 days to keep using Unlock Flow."
  },
  "subscription-expired": {
    icon: "💳", cls: "warn", title: "Subscription expired",
    sub: "Submit your payment receipt to renew access."
  }
};

function fmtRemaining(ms) {
  if (ms <= 0) return "0m left";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${sec}s left`;
  return `${sec}s left`;
}

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

function renderStatus() {
  const gate = state.gate;
  const icon = $("#heroIcon");
  const title = $("#heroTitle");
  const sub = $("#heroSub");
  const track = $("#heroTrack");
  const fill = $("#heroFill");
  const toggle = $("#enabledToggle");
  const chip = $("#accountChip");
  const adminBtn = $("#openAdmin");

  icon.className = "heroIcon";
  track.hidden = true;

  if (!gate) {
    icon.textContent = "⏳";
    title.textContent = "Checking access…";
    sub.textContent = "One moment";
    toggle.disabled = true;
    toggle.checked = false;
    return;
  }

  // Account chip
  chip.textContent = gate.signedIn
    ? (gate.role === "admin" ? "Admin" : (state.userEmail || "Account"))
    : "Sign in";

  adminBtn.hidden = gate.role !== "admin";

  if (gate.access && gate.reason === "trial") {
    icon.textContent = "⏳"; icon.classList.add("acc");
    title.textContent = "Free trial active";
    const total = 2 * 3600 * 1000;
    const remaining = gate.trialEndsAt - Date.now();
    sub.textContent = fmtRemaining(remaining);
    track.hidden = false;
    fill.classList.remove("warn");
    fill.style.width = `${Math.max(2, Math.min(100, (1 - remaining / total) * 100))}%`;
  } else if (gate.access && (gate.reason === "active" || gate.reason === "admin")) {
    icon.textContent = "✅"; icon.classList.add("ok");
    title.textContent = "Subscription active";
    if (gate.reason === "admin") {
      sub.textContent = "Administrator access";
    } else {
      const remaining = gate.paidThrough - Date.now();
      sub.textContent = `Until ${fmtDate(gate.paidThrough)} · ${fmtRemaining(remaining)}`;
      track.hidden = false;
      const total = 30 * 86400 * 1000;
      fill.classList.remove("warn");
      fill.style.width = `${Math.max(2, Math.min(100, (1 - remaining / total) * 100))}%`;
    }
  } else {
    const info = MESSAGES[gate.reason] || MESSAGES.offline;
    icon.textContent = info.icon;
    if (info.cls) icon.classList.add(info.cls);
    title.textContent = info.title;
    sub.textContent = info.sub;
  }

  // Toggle
  const enabled = Boolean(gate.access && gate.enabled);
  toggle.disabled = !gate.access;
  toggle.checked = enabled;
  $("#switchHint").textContent = gate.access
    ? (enabled ? "Region patch is on" : "Turn on to patch Flow")
    : "Subscribe to enable";
}

function startCountdown() {
  stopCountdown();
  state.countdownTimer = setInterval(() => {
    if (document.body.dataset.screen !== "status") return stopCountdown();
    const gate = state.gate;
    if (!gate || !gate.access) return;
    if (gate.reason === "trial" && gate.trialEndsAt) {
      const remaining = gate.trialEndsAt - Date.now();
      $("#heroSub").textContent = fmtRemaining(remaining);
      $("#heroFill").style.width = `${Math.max(2, Math.min(100, (1 - remaining / (2 * 3600 * 1000)) * 100))}%`;
      if (remaining <= 0) syncGate();
    } else if (gate.paidThrough) {
      const remaining = gate.paidThrough - Date.now();
      $("#heroSub").textContent = `Until ${fmtDate(gate.paidThrough)} · ${fmtRemaining(remaining)}`;
      $("#heroFill").style.width = `${Math.max(2, Math.min(100, (1 - remaining / (30 * 86400 * 1000)) * 100))}%`;
      if (remaining <= 0) syncGate();
    }
  }, 1000);
}

function stopCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = null;
}

/* ------------------------------------------------------------- gate sync */

async function syncGate() {
  const res = await chrome.runtime.sendMessage({ type: "uf:sync" });
  if (res) {
    state.gate = res;
    if (!res.signedIn) state.userEmail = null;
    renderStatus();
  }
  return res;
}

/* ---------------------------------------------------------------- actions */

$("#enabledToggle").addEventListener("change", async () => {
  const res = await chrome.runtime.sendMessage({
    type: "uf:setUserEnabled",
    enabled: $("#enabledToggle").checked
  });
  if (res) { state.gate = res; renderStatus(); }
});

async function openFlow(createIfMissing = true) {
  const ORIGIN = "https://flow.google.com/";
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = active && active.url && active.url.startsWith(ORIGIN) ? active : null;
  if (!tab) {
    const tabs = await chrome.tabs.query({ url: ORIGIN + "*", currentWindow: true });
    tab = tabs[0];
  }
  if (!tab) {
    if (createIfMissing) await chrome.tabs.create({ url: ORIGIN });
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

$("#enterFlow").addEventListener("click", () => openFlow(true));
$("#refreshBtn").addEventListener("click", async () => {
  $("#refreshBtn").disabled = true;
  await syncGate();
  $("#refreshBtn").disabled = false;
  toast("Updated");
});
$("#openAdmin").addEventListener("click", () => go("admin"));
$("#accountChip").addEventListener("click", () => {
  if (state.gate && state.gate.signedIn) go("dashboard");
  else go("login");
});

/* ============================================================================
 * LOGIN / SIGNUP / CODE
 * ==========================================================================*/

$("#toSignup").addEventListener("click", () => go("signup"));
$("#toLogin").addEventListener("click", () => go("login"));

async function signIn(data) {
  state.token = data.token;
  state.userEmail = data.user && data.user.email;
  await chrome.storage.local.set({ token: data.token });
  await syncGate();
  go("status");
  toast(`Signed in as ${state.userEmail || "admin"}`);
}

$("#loginBtn").addEventListener("click", async () => {
  clearErr($("#loginError"));
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  if (!email || !password) return showErr($("#loginError"), "Enter your email and password.");

  busy($("#loginBtn"), true, "Signing in…");
  try {
    const data = await api("/api/v1/auth/login", { method: "POST", body: { email, password }, auth: false });
    $("#loginPassword").value = "";
    await signIn(data);
  } catch (err) {
    if (err.status === 409 && err.data && err.data.needsVerification) {
      state.codeEmail = err.data.email || email;
      openCodeScreen();
      if (err.data.devCode) fillOtp(err.data.devCode, true); // dev auto-verify
      toast("Email not verified yet — enter the code");
    } else {
      showErr($("#loginError"), err.message);
    }
  } finally {
    busy($("#loginBtn"), false);
  }
});

$("#signupBtn").addEventListener("click", async () => {
  clearErr($("#signupError"));
  const email = $("#signupEmail").value.trim();
  const password = $("#signupPassword").value;
  const password2 = $("#signupPassword2").value;

  if (!email) return showErr($("#signupError"), "Enter your Gmail address.");
  if (password.length < 8) return showErr($("#signupError"), "Password must be at least 8 characters.");
  if (password !== password2) return showErr($("#signupError"), "Passwords don't match.");

  busy($("#signupBtn"), true, "Creating account…");
  try {
    const data = await api("/api/v1/auth/signup", { method: "POST", body: { email, password }, auth: false });
    state.codeEmail = data.email || email;
    openCodeScreen();
    if (data.devCode) fillOtp(data.devCode, true); // dev auto-verify
    else toast("We emailed you a 6-digit code");
  } catch (err) {
    showErr($("#signupError"), err.message);
  } finally {
    busy($("#signupBtn"), false);
  }
});

/* ------------------------------------------------------------------- OTP */

const otpInputs = $$("#otp input");

function otpValue() {
  return otpInputs.map(i => i.value).join("");
}

function fillOtp(code, autoVerify) {
  String(code).split("").slice(0, 6).forEach((digit, i) => { otpInputs[i].value = digit; });
  otpInputs.forEach(i => i.classList.toggle("filled", Boolean(i.value)));
  updateVerifyButton();
  if (autoVerify) setTimeout(verifyCode, 350);
}

function updateVerifyButton() {
  $("#verifyBtn").disabled = otpValue().length !== 6;
}

otpInputs.forEach((input, index) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 1);
    input.classList.toggle("filled", Boolean(input.value));
    if (input.value && index < 5) otpInputs[index + 1].focus();
    updateVerifyButton();
    if (otpValue().length === 6) verifyCode(); // auto-verify on complete
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Backspace" && !input.value && index > 0) {
      otpInputs[index - 1].focus();
      otpInputs[index - 1].value = "";
      otpInputs[index - 1].classList.remove("filled");
      updateVerifyButton();
    }
  });
  input.addEventListener("paste", e => {
    e.preventDefault();
    const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6).split("");
    digits.forEach((d, i) => {
      otpInputs[i].value = d;
      otpInputs[i].classList.add("filled");
    });
    updateVerifyButton();
    if (otpValue().length === 6) verifyCode();
  });
});

function openCodeScreen() {
  $("#codeEmail").textContent = state.codeEmail;
  otpInputs.forEach(i => { i.value = ""; i.classList.remove("filled"); });
  updateVerifyButton();
  clearErr($("#codeError"));
  startResendCooldown();
  go("code");
  setTimeout(() => otpInputs[0].focus(), 120);
}

function startResendCooldown(seconds = 60) {
  clearInterval(state.resendTimer);
  let left = seconds;
  const label = $("#resendTimer");
  const btn = $("#resendBtn");
  btn.disabled = true;
  label.textContent = `Resend in ${left}s`;
  state.resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(state.resendTimer);
      label.textContent = "";
      btn.disabled = false;
      return;
    }
    label.textContent = `Resend in ${left}s`;
  }, 1000);
}

async function verifyCode() {
  const code = otpValue();
  if (code.length !== 6) return;
  clearErr($("#codeError"));
  busy($("#verifyBtn"), true, "Verifying…");
  try {
    const data = await api("/api/v1/auth/verify", {
      method: "POST",
      body: { email: state.codeEmail, code },
      auth: false
    });
    await signIn(data);
  } catch (err) {
    showErr($("#codeError"), err.message);
    otpInputs.forEach(i => { i.value = ""; i.classList.remove("filled"); });
    updateVerifyButton();
    otpInputs[0].focus();
  } finally {
    busy($("#verifyBtn"), false);
    updateVerifyButton();
  }
}

$("#verifyBtn").addEventListener("click", verifyCode);

$("#resendBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/v1/auth/resend", {
      method: "POST",
      body: { email: state.codeEmail },
      auth: false
    });
    startResendCooldown();
    if (data.devCode) fillOtp(data.devCode, true);
    else toast("New code sent");
  } catch (err) {
    showErr($("#codeError"), err.message);
  }
});

/* ============================================================================
 * DASHBOARD (account + billing)
 * ==========================================================================*/

async function loadConfig() {
  if (state.config) return state.config;
  try {
    state.config = await api("/api/v1/config", { auth: false });
    const p = state.config.plan;
    $("#planPrice").textContent = `${p.priceEtb} ETB`;
    $("#planDays").textContent = p.days;
    $("#telebirrNumber").textContent = p.telebirrNumber || "—";
    $("#abyssiniaNumber").textContent = p.abyssiniaNumber || "—";
    $("#holderTelebirr").textContent = p.holderName;
    $("#holderAbyssinia").textContent = p.holderName;
  } catch { /* keep defaults */ }
  return state.config;
}

async function loadDashboard() {
  await loadConfig();
  await syncGate();

  const gate = state.gate || {};
  const icon = $("#planIcon");
  icon.className = "heroIcon small";
  $("#planEmail").textContent = state.userEmail || "";

  if (gate.access && gate.reason === "trial") {
    icon.textContent = "⏳"; icon.classList.add("acc");
    $("#planTitle").textContent = "Free trial";
    $("#planSub").textContent = `Ends in ${fmtRemaining(gate.trialEndsAt - Date.now())} — subscribe below to continue.`;
  } else if (gate.access) {
    icon.textContent = "✅"; icon.classList.add("ok");
    $("#planTitle").textContent = gate.reason === "admin" ? "Administrator" : "Subscription active";
    $("#planSub").textContent = gate.reason === "admin"
      ? "Full admin access."
      : `Active until ${fmtDate(gate.paidThrough)} (${fmtRemaining(gate.paidThrough - Date.now())}).`;
  } else if (gate.reason === "trial-expired" || gate.reason === "subscription-expired") {
    icon.textContent = "⏳"; icon.classList.add("warn");
    $("#planTitle").textContent = "Payment required";
    $("#planSub").textContent = "Pay, then submit your receipt link below. Access starts when it's approved.";
  } else {
    icon.textContent = "🔒"; icon.classList.add("bad");
    $("#planTitle").textContent = "No access";
    $("#planSub").textContent = "Sign in with your account to see your plan.";
  }

  loadHistory();
}

async function loadHistory() {
  try {
    const data = await api("/api/v1/receipts");
    const list = $("#historyList");
    $("#historyCard").hidden = !data.receipts || data.receipts.length === 0;
    list.innerHTML = "";
    (data.receipts || []).forEach(r => {
      const li = document.createElement("li");
      li.className = "item";
      const when = new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      li.innerHTML = `
        <div class="itemHead">
          <b>${r.method === "telebirr" ? "Telebirr" : "Bank of Abyssinia"} · ${r.amountEtb} ETB</b>
          <span class="status ${r.status}">${r.status}</span>
        </div>
        <div class="itemMeta">${when} — ${r.url.replace(/^https?:\/\//, "").slice(0, 42)}…</div>
        ${r.status === "rejected" && r.adminNote ? `<div class="itemNote">${escapeHtml(r.adminNote)}</div>` : ""}`;
      list.appendChild(li);
    });
  } catch { /* history is non-critical */ }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("#submitReceipt").addEventListener("click", async () => {
  clearErr($("#receiptError"));
  const url = $("#receiptUrl").value.trim();
  const method = $("#receiptMethod").value;
  if (!url) return showErr($("#receiptError"), "Paste your receipt link first.");

  busy($("#submitReceipt"), true, "Submitting…");
  try {
    await api("/api/v1/receipts", { method: "POST", body: { url, method } });
    $("#receiptUrl").value = "";
    toast("Receipt submitted — waiting for admin review");
    loadHistory();
  } catch (err) {
    showErr($("#receiptError"), err.message);
  } finally {
    busy($("#submitReceipt"), false);
  }
});

$$(".copy").forEach(btn =>
  btn.addEventListener("click", async () => {
    const text = document.getElementById(btn.dataset.copy).textContent.trim();
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied ✓");
    } catch {
      toast("Couldn't copy — long-press to copy");
    }
  })
);

$("#signOutBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "uf:signOut" });
  state.token = null;
  state.userEmail = null;
  state.gate = null;
  renderStatus();
  go("status");
  toast("Signed out");
});

/* ============================================================================
 * ADMIN
 * ==========================================================================*/

$$("[data-atab]").forEach(tab =>
  tab.addEventListener("click", () => {
    state.adminTab = tab.dataset.atab;
    $$("[data-atab]").forEach(t => t.classList.toggle("active", t === tab));
    $("#adminPending").hidden = state.adminTab !== "pending";
    $("#adminUsers").hidden = state.adminTab !== "users";
  })
);

async function loadAdmin() {
  await loadStats();
  await loadQueue();
  await loadUsers();
}

async function loadStats() {
  try {
    const s = await api("/api/v1/admin/stats");
    $("#adminStats").innerHTML = `
      <div class="stat"><b>${s.pending}</b><small>Pending</small></div>
      <div class="stat"><b>${s.activeSubs}</b><small>Subscribed</small></div>
      <div class="stat"><b>${s.activeTrials}</b><small>Trials</small></div>
      <div class="stat"><b>${s.totalUsers}</b><small>Users</small></div>`;
  } catch {
    $("#adminStats").innerHTML = "";
  }
}

async function loadQueue() {
  const list = $("#queueList");
  try {
    const data = await api("/api/v1/admin/receipts?status=pending");
    if (!data.receipts.length) {
      list.innerHTML = `<li class="empty">No pending receipts 🎉</li>`;
      return;
    }
    list.innerHTML = "";
    data.receipts.forEach(r => {
      const li = document.createElement("li");
      li.className = "item";
      const when = new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      li.innerHTML = `
        <div class="itemHead">
          <b>${escapeHtml(r.email)}</b>
          <span class="status pending">${r.method}</span>
        </div>
        <div class="itemMeta">${when} · ${r.amountEtb} ETB</div>
        <a class="itemMeta" href="#" style="color:var(--accent-deep);font-weight:700">${escapeHtml(r.url.slice(0, 60))}${r.url.length > 60 ? "…" : ""}</a>
        <input class="noteInput" placeholder="Note (optional, sent on reject)" maxlength="200">
        <div class="itemActions">
          <button class="btn tiny primary actOpen">Open link</button>
          <button class="btn tiny approve actApprove">Approve +30d</button>
          <button class="btn tiny danger actReject">Reject</button>
        </div>`;

      li.querySelector("a").addEventListener("click", e => { e.preventDefault(); openLink(r.url); });
      li.querySelector(".actOpen").addEventListener("click", () => openLink(r.url));
      li.querySelector(".actApprove").addEventListener("click", async e => {
        busy(e.target, true, "…");
        try {
          await api(`/api/v1/admin/receipts/${r._id}/resolve`, {
            method: "POST",
            body: { action: "approve", note: li.querySelector(".noteInput").value }
          });
          toast(`${r.email} approved — +30 days`);
          await Promise.all([loadQueue(), loadStats()]);
        } catch (err) { toast(err.message); busy(e.target, false); }
      });
      li.querySelector(".actReject").addEventListener("click", async e => {
        busy(e.target, true, "…");
        try {
          await api(`/api/v1/admin/receipts/${r._id}/resolve`, {
            method: "POST",
            body: { action: "reject", note: li.querySelector(".noteInput").value }
          });
          toast(`${r.email} rejected`);
          await Promise.all([loadQueue(), loadStats()]);
        } catch (err) { toast(err.message); busy(e.target, false); }
      });
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = `<li class="empty">${escapeHtml(err.message)}</li>`;
  }
}

function openLink(url) {
  chrome.tabs.create({ url });
}

async function loadUsers(search = "") {
  const list = $("#userList");
  try {
    const data = await api(`/api/v1/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`);
    if (!data.users.length) {
      list.innerHTML = `<li class="empty">No users found</li>`;
      return;
    }
    list.innerHTML = "";
    data.users.forEach(u => {
      const li = document.createElement("li");
      li.className = "item";
      const status = u.active
        ? (u.paidThrough && new Date(u.paidThrough).getTime() > Date.now() ? `Until ${fmtDate(u.paidThrough)}` : "Trial")
        : "Locked";
      li.innerHTML = `
        <div class="itemHead">
          <b>${escapeHtml(u.email)}</b>
          <span class="status ${u.active ? "active" : "inactive"}">${u.active ? "active" : "locked"}</span>
        </div>
        <div class="itemMeta">${status} · joined ${fmtDate(u.createdAt)}</div>
        <div class="itemActions">
          <button class="btn tiny primary actExtend">+30 days</button>
          <button class="btn tiny danger actRevoke">Revoke access</button>
        </div>`;
      li.querySelector(".actExtend").addEventListener("click", async e => {
        busy(e.target, true, "…");
        try {
          const res = await api(`/api/v1/admin/users/${u._id}/extend`, { method: "POST", body: { days: 30 } });
          toast(`${u.email} → until ${fmtDate(res.paidThrough)}`);
          await Promise.all([loadUsers(search), loadStats()]);
        } catch (err) { toast(err.message); busy(e.target, false); }
      });
      li.querySelector(".actRevoke").addEventListener("click", async e => {
        busy(e.target, true, "…");
        try {
          await api(`/api/v1/admin/users/${u._id}/revoke`, { method: "POST", body: {} });
          toast(`${u.email} revoked`);
          await Promise.all([loadUsers(search), loadStats()]);
        } catch (err) { toast(err.message); busy(e.target, false); }
      });
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = `<li class="empty">${escapeHtml(err.message)}</li>`;
  }
}

let searchDebounce = null;
$("#userSearch").addEventListener("input", e => {
  clearTimeout(searchDebounce);
  const value = e.target.value.trim();
  searchDebounce = setTimeout(() => loadUsers(value), 350);
});

/* ============================================================================
 * BOOT
 * ==========================================================================*/

async function boot() {
  const stored = await chrome.storage.local.get(["token", "gate", "userEnabled"]);
  state.token = stored.token || null;
  state.gate = stored.gate || null;
  if (stored.userEnabled === undefined) {
    await chrome.storage.local.set({ userEnabled: true });
  }

  // Background keeps the gate fresh — reflect its updates live.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.token) state.token = changes.token.newValue || null;
    if (changes.gate) {
      state.gate = changes.gate.newValue || null;
      if (document.body.dataset.screen === "status") renderStatus();
    }
  });

  renderStatus();
  startCountdown();

  if (state.token) {
    try {
      const me = await api("/api/v1/me");
      state.userEmail = me.user.email;
      renderStatus();
    } catch { /* sync will handle it */ }
    syncGate();
  } else {
    go("status");
  }
}

boot();
