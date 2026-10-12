import { API_BASE_URL } from "../config.js";

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

function renderAccount(account) {
  const { quota } = account;
  const unlimited = quota.limit === null;

  document.getElementById("user-name").textContent = account.user.name;
  document.getElementById("user-email").textContent = account.user.email;
  document.getElementById("plan-name").textContent = account.plan_name || account.plan;
  document.getElementById("quota-label").textContent = unlimited
    ? `${quota.used} · ilimitado`
    : `${quota.used} / ${quota.limit}`;
  document.getElementById("quota-bar").style.width = unlimited
    ? "0%"
    : `${quota.limit === 0 ? 100 : Math.min(100, (quota.used / quota.limit) * 100)}%`;
  document.getElementById("quota-resets").textContent = `Se reinicia el ${formatDate(quota.resets_at)}`;

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
    renderAccount(response.data);
  } else {
    show("signedOut");
  }
}

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
    refresh();
  }
});

refresh();
