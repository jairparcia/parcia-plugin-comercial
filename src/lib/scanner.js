import { apiFetch } from "./api.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A TikTok video opened as an overlay (from a profile, For You or search) is
// only described by the JSON TikTok fetched for it, which
// content/tiktok-interceptor.js keeps in the page (world MAIN). The JSON can
// land a moment after the URL changes, so this waits for it briefly.
async function tiktokVideoFromPage(tabId, url) {
  const videoId = new URL(url).pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1];
  if (!videoId) return null;

  let state = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (id) => {
        const map = window.__parciaTiktokVideos;
        const item = map?.get(id);
        return {
          item: item ? JSON.parse(JSON.stringify(item)) : null,
          interceptorLoaded: Boolean(map),
          videosCaptured: map?.size ?? 0,
          capture: window.__parciaTiktokCapture ?? null,
        };
      },
      args: [videoId],
    });
    state = injection?.result;
    if (state?.item) return state.item;
    await sleep(500);
  }

  // Tells apart "interceptor not running" (tab opened before the extension
  // was loaded/reloaded) from "TikTok sent this video in a shape we miss".
  console.warn("[Parcia] TikTok video not captured", videoId, {
    interceptorLoaded: state?.interceptorLoaded,
    videosCaptured: state?.videosCaptured,
    apiResponsesSeen: state?.capture?.responses,
    lastApiUrl: state?.capture?.lastUrl,
  });
  return null;
}

// Reads the page in the tab (scrapers/*.js, injected into the extension's
// isolated world) and returns { kind, payload, display? } or null.
export async function scrapeTab(tab, page) {
  const hints = {};
  if (page.platform === "tiktok" && page.kind === "publication") {
    hints.tiktokItem = await tiktokVideoFromPage(tab.id, tab.url);
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["scrapers/common.js", `scrapers/${page.platform}.js`],
  });

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (scrapeHints) => globalThis.__parciaScrape(scrapeHints),
    args: [hints],
  });

  return injection?.result ?? null;
}

// Sends the scan to the API: module + monthly quota are enforced there.
// Resolves with { counted, remaining_quota, quota }; throws ApiError on 401/402/403/422.
export function ingest(scraped) {
  const payload = { ...scraped.payload };

  // Keep free text within the API limits (IngestCreatorRequest).
  if (payload.display_name) payload.display_name = String(payload.display_name).slice(0, 255);

  return apiFetch(`ingest/${scraped.kind}`, { method: "POST", body: payload });
}
