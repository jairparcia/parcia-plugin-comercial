import { API_BASE_URL } from "../config.js";
import { apiFetch } from "./api.js";
import { clearToken, setToken } from "./session.js";

// Sign-in through the parcia-control-comercial web app (Google sign-in
// happens there), OAuth-style with PKCE, in a regular browser tab:
//   1. startSignIn() opens /plugin/connect in a new tab;
//   2. the user signs in / confirms; the web app redirects that tab to our
//      own page chrome-extension://<id>/auth/callback.html?code=…&state=…;
//   3. the callback page calls completeSignIn(), which exchanges the
//      single-use code + verifier for a bearer token.
// The user may take minutes to sign in and Chrome can stop the service worker
// meanwhile, so the pending state lives in chrome.storage.session (memory
// only, cleared when the browser closes), not in a variable.

const PENDING_KEY = "parcia.pendingSignIn";
const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

export const REDIRECT_URI = chrome.runtime.getURL("auth/callback.html");

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(byteLength) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64Url(new Uint8Array(digest));
}

function deviceName() {
  const data = navigator.userAgentData;
  const brand = data?.brands?.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand))?.brand ?? "Chrome";
  const platform = data?.platform || "";
  return platform ? `${brand} · ${platform}` : brand;
}

// Opens the sign-in tab. `returnTabId` is the tab to go back to afterwards.
export async function startSignIn(returnTabId) {
  const verifier = randomString(48);
  const state = randomString(24);

  // A new attempt replaces any previous unfinished one.
  await chrome.storage.session.set({
    [PENDING_KEY]: { state, verifier, returnTabId: returnTabId ?? null, startedAt: Date.now() },
  });

  const connectUrl = new URL(`${API_BASE_URL}/plugin/connect`);
  connectUrl.search = new URLSearchParams({
    redirect_uri: REDIRECT_URI,
    code_challenge: await sha256Base64Url(verifier),
    state,
    device: deviceName(),
  }).toString();

  await chrome.tabs.create({ url: connectUrl.toString(), active: true });
}

// Called by the callback page with the query it received.
// Returns the tab to go back to; throws when the sign-in did not complete.
export async function completeSignIn({ code, state, error }) {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const pending = stored[PENDING_KEY];

  // Only the attempt this extension started, and only once.
  if (!pending || !state || pending.state !== state || Date.now() - pending.startedAt > PENDING_MAX_AGE_MS) {
    throw new Error("state_mismatch");
  }
  await chrome.storage.session.remove(PENDING_KEY);

  if (error) {
    throw Object.assign(new Error(error), { returnTabId: pending.returnTabId });
  }

  const result = await apiFetch("plugin/token", {
    method: "POST",
    auth: false,
    body: { code, code_verifier: pending.verifier, redirect_uri: REDIRECT_URI },
  });

  await setToken(result.token);

  return pending.returnTabId;
}

export async function signOut() {
  try {
    await apiFetch("plugin/logout", { method: "POST" });
  } finally {
    // Signed out locally even if the server is unreachable.
    await clearToken();
  }
}

export function getAccount() {
  return apiFetch("plugin/me");
}
