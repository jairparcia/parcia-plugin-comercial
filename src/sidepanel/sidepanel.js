import { API_BASE_URL } from "../config.js";
import { classifyPage } from "../lib/pages.js";
import { ingest, scrapeTab } from "../lib/scanner.js";
import * as scanView from "./scan-view.js";

const MODULE_LABELS = { tiktok: "TikTok", instagram: "Instagram", modash: "Modash" };

const views = {
  loading: document.getElementById("view-loading"),
  signedOut: document.getElementById("view-signed-out"),
  signedIn: document.getElementById("view-signed-in"),
};

const signInButton = document.getElementById("btn-sign-in");
const signOutButton = document.getElementById("btn-sign-out");
const signInError = document.getElementById("sign-in-error");
const signInHint = document.getElementById("sign-in-hint");

// Signed-in account (/api/plugin/me), null when signed out.
let account = null;

function show(name) {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
}

function send(type) {
  return chrome.runtime.sendMessage({ type });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

function renderQuota(quota) {
  const unlimited = quota.limit === null;

  document.getElementById("quota-label").textContent = unlimited
    ? `${quota.used} · ilimitado`
    : `${quota.used} / ${quota.limit}`;
  document.getElementById("quota-bar").style.width = unlimited
    ? "0%"
    : `${quota.limit === 0 ? 100 : Math.min(100, (quota.used / quota.limit) * 100)}%`;
  document.getElementById("quota-resets").textContent = `Se reinicia el ${formatDate(quota.resets_at)}`;
}

function renderAccount() {
  document.getElementById("user-name").textContent = account.user.name;
  document.getElementById("user-email").textContent = account.user.email;
  document.getElementById("plan-name").textContent = account.plan_name || account.plan;
  renderQuota(account.quota);

  const list = document.getElementById("modules");
  list.replaceChildren(
    ...(account.modules.length
      ? account.modules.map((key) => Object.assign(document.createElement("li"), { textContent: MODULE_LABELS[key] ?? key }))
      : [Object.assign(document.createElement("li"), { textContent: "Ninguna" })])
  );

  show("signedIn");
}

async function refresh() {
  show("loading");
  signInHint.hidden = true;
  const response = await send("auth:account");

  if (response.ok) {
    account = response.data;
    renderAccount();
    scanActiveTab();
  } else {
    account = null;
    show("signedOut");
  }
}

// ── Scanner ──────────────────────────────────────────────────────────────────
// While the panel is open and signed in, every TikTok/Instagram profile or
// post shown in the active tab is scanned once: the API checks the module and
// the monthly quota (a creator already scanned this month is free). Results
// are cached per page for this panel session, so switching back and forth
// between tabs does not resend.

const results = new Map(); // page key → { scraped, response }
let scanRun = 0;           // newest scan wins; older ones drop their result
let windowId = null;

async function activeTab() {
  windowId ??= (await chrome.windows.getCurrent()).id;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab ?? null;
}

async function scanActiveTab({ force = false } = {}) {
  if (!account) return;

  const run = ++scanRun;
  const tab = await activeTab();
  const page = tab?.url ? classifyPage(tab.url) : null;

  if (!page) {
    scanView.renderIdle();
    return;
  }

  // The server enforces it too; this only avoids a pointless request.
  if (!account.modules.includes(page.platform)) {
    scanView.renderModuleDenied(page.platform);
    return;
  }

  const cached = results.get(page.key);
  if (cached && !force) {
    scanView.renderResult(cached.scraped, cached.response);
    return;
  }

  scanView.renderScanning(page);

  let scraped;
  try {
    scraped = await scrapeTab(tab, page);
  } catch (error) {
    console.warn("[Parcia] Could not read the page", error);
    scraped = null;
  }
  if (run !== scanRun) return;

  if (!scraped) {
    scanView.renderUnreadable();
    return;
  }

  try {
    const response = await ingest(scraped);
    if (run !== scanRun) return;

    results.set(page.key, { scraped, response });
    account.quota = response.quota;
    renderQuota(response.quota);
    scanView.renderResult(scraped, response);
  } catch (error) {
    if (run !== scanRun) return;

    if (error.status === 402) {
      if (error.body?.quota) renderQuota(error.body.quota);
      scanView.renderQuotaExceeded(error.body?.quota);
    } else if (error.status === 403) {
      scanView.renderModuleDenied(error.body?.module ?? page.platform);
    } else if (error.status === 422) {
      console.warn("[Parcia] Payload rejected", error.body, scraped.payload);
      scanView.renderUnreadable();
    } else if (error.status !== 401) {
      // 401: the token was dropped and the storage listener shows the sign-in.
      console.warn("[Parcia] Scan failed", error);
      scanView.renderFailure();
    }
  }
}

// SPA navigation fires several updates in a row: wait until it settles.
let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => scanActiveTab(), 500);
}

chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId === windowId) scheduleScan();
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && tab.windowId === windowId && (change.url || change.status === "complete")) {
    scheduleScan();
  }
});

scanView.onRescan(() => scanActiveTab({ force: true }));
scanView.setUpgradeUrl(`${API_BASE_URL}/billing`);

// ── Session ──────────────────────────────────────────────────────────────────

signInButton.addEventListener("click", async () => {
  signInButton.disabled = true;
  signInError.hidden = true;

  // Opens the sign-in tab. The user finishes there; when the token is stored
  // the storage listener below shows the account.
  const response = await send("auth:sign-in");

  signInButton.disabled = false;

  if (response.ok) {
    signInHint.hidden = false;
  } else {
    signInError.textContent = "No se pudo abrir el inicio de sesión. Inténtalo de nuevo.";
    signInError.hidden = false;
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  await send("auth:sign-out");
  signOutButton.disabled = false;
  show("signedOut");
});

document.getElementById("link-portal").href = `${API_BASE_URL}/dashboard`;

// The panel stays open for a long time: follow session changes made anywhere
// (sign-in finishing, sign-out, or a 401 after "Disconnect" in the portal).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "parcia.token" in changes) {
    results.clear();
    refresh();
  }
});

refresh();
