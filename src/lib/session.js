// The plugin token lives only in chrome.storage.local (never in page
// context or content scripts).
const TOKEN_KEY = "parcia.token";

export async function getToken() {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  return stored[TOKEN_KEY] ?? null;
}

export async function setToken(token) {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

export async function clearToken() {
  await chrome.storage.local.remove(TOKEN_KEY);
}
