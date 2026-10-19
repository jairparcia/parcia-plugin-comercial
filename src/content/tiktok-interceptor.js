// Runs in TikTok's own page context (world MAIN, document_start).
//
// When a video is opened from a profile, the For You feed or search, TikTok
// shows it in an overlay and only changes the URL: the page HTML still
// describes the page the user came from, so the video's metrics are only in
// the JSON TikTok's web app fetched for it. This keeps every video-shaped
// object (id + stats + author) seen in any /api/ response — profile lists,
// feed, search, related, item detail — in a page-memory map keyed by id.
// The scanner reads it with chrome.scripting (world MAIN). Nothing leaves the
// page and nothing is stored: the map dies with the tab.
(function () {
  if (window.__parciaTiktokVideos) return;

  const MAX_VIDEOS = 1000;
  const videos = new Map();
  window.__parciaTiktokVideos = videos;
  // Diagnostics, read by the scanner when a video is missing.
  window.__parciaTiktokCapture = { responses: 0, lastUrl: null };

  // Same shape the old parcia-plugin relied on (itemList[] / itemInfo.itemStruct):
  // a numeric id + stats. `author` is not required — list responses do not
  // always embed it.
  function isVideo(node) {
    return /^\d{15,}$/.test(String(node.id ?? "")) && Boolean(node.stats || node.statsV2);
  }

  function collect(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;

    if (Array.isArray(node)) {
      for (const child of node) collect(child, depth + 1);
      return;
    }

    if (isVideo(node)) {
      const id = String(node.id);
      videos.delete(id); // re-insert as newest
      videos.set(id, node);
      if (videos.size > MAX_VIDEOS) videos.delete(videos.keys().next().value);
    }

    for (const key in node) {
      const child = node[key];
      if (child && typeof child === "object") collect(child, depth + 1);
    }
  }

  function isApi(url) {
    return typeof url === "string" && url.includes("/api/");
  }

  function capture(url, json) {
    window.__parciaTiktokCapture.responses++;
    window.__parciaTiktokCapture.lastUrl = url.split("?")[0];
    collect(json, 0);
  }

  // fetch(input) accepts a string, a URL or a Request.
  function urlOf(input) {
    if (typeof input === "string") return input;
    return input?.url ?? input?.href ?? null;
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = urlOf(args[0]);
      if (isApi(url)) {
        response.clone().json().then((json) => capture(url, json)).catch(() => {});
      }
    } catch (e) {
      // never break TikTok's own request
    }
    return response;
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (!isApi(this.responseURL)) return;
        const json = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
        capture(this.responseURL, json);
      } catch (e) {
        // not JSON
      }
    });
    return originalSend.apply(this, args);
  };
})();
