import { completeSignIn, getAccount, signOut, startSignIn } from "./lib/auth.js";

// The plugin lives in Chrome's side panel (right side; the page shrinks
// instead of being covered). Clicking the toolbar icon opens it.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

// After the callback page finishes: close it and go back to where the user was.
async function closeCallbackTab(callbackTabId, returnTabId) {
  if (returnTabId !== null && returnTabId !== undefined) {
    await chrome.tabs.update(returnTabId, { active: true }).catch(() => {});
  }
  if (callbackTabId !== undefined) {
    await chrome.tabs.remove(callbackTabId).catch(() => {});
  }
}

// The side panel and the callback page delegate every auth action here.
const handlers = {
  "auth:sign-in": async () => startSignIn(await activeTabId()),
  // On success the callback page moves on to the web app's confirmation page
  // (the tab stays open). Only a cancellation closes the tab and goes back.
  "auth:complete": async (message, sender) => {
    try {
      await completeSignIn(message.params ?? {});
    } catch (error) {
      if (error.message === "access_denied") {
        setTimeout(() => closeCallbackTab(sender.tab?.id, error.returnTabId), 1200);
      }
      throw error;
    }
  },
  "auth:sign-out": () => signOut(),
  "auth:account": () => getAccount(),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our own extension pages may ask.
  if (sender.id !== chrome.runtime.id || !handlers[message?.type]) {
    return false;
  }

  handlers[message.type](message, sender)
    .then((data) => sendResponse({ ok: true, data: data ?? null }))
    .catch((error) =>
      sendResponse({ ok: false, status: error.status ?? null, code: error.code ?? null, message: error.message })
    );

  return true; // async response
});
