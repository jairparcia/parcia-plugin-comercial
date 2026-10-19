// TikTok scraper (needs common.js). Returns the API payload for the current
// page, or null when the page cannot be read as the URL's own creator/video.
// Every source is tied to the handle / video id in the URL, so a stale SPA
// fragment of the previous page is never sent.

function parciaTiktokHydration(root) {
  const script = root.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent)?.__DEFAULT_SCOPE__ ?? null;
  } catch (e) {
    return null;
  }
}

function parciaTiktokHandle() {
  return location.pathname.match(/^\/@([^/?#]+)/)?.[1] ?? null;
}

// Exact numbers from the hydration JSON, only if it is this profile's.
function parciaTiktokProfileFromHydration(root, handle) {
  const info = parciaTiktokHydration(root)?.["webapp.user-detail"]?.userInfo;
  const user = info?.user;
  if (!user || String(user.uniqueId).toLowerCase() !== handle.toLowerCase()) return null;

  const stats = info.statsV2 ?? info.stats ?? {};
  return {
    display_name: user.nickname,
    avatar_url: user.avatarLarger || user.avatarMedium,
    followers: parciaParseCount(stats.followerCount),
    following: parciaParseCount(stats.followingCount),
    likes: parciaParseCount(stats.heartCount ?? stats.heart),
    posts_count: parciaParseCount(stats.videoCount),
    profile: parciaCompact({
      biography: user.signature,
      external_url: user.bioLink?.link,
      is_verified: typeof user.verified === "boolean" ? user.verified : null,
      is_private: typeof user.privateAccount === "boolean" ? user.privateAccount : null,
    }),
  };
}

// Visible counters ("1.2M"), only once the header shows this handle.
function parciaTiktokProfileFromDom(handle) {
  const title = document.querySelector('[data-e2e="user-title"]')?.textContent?.trim();
  if (!title || title.replace(/^@/, "").toLowerCase() !== handle.toLowerCase()) return null;

  const text = (selector) => document.querySelector(selector)?.textContent?.trim();
  const followers = text('[data-e2e="followers-count"]');
  if (!followers) return null;

  return {
    display_name: text('[data-e2e="user-subtitle"]'),
    avatar_url: document.querySelector('[data-e2e="user-avatar"] img')?.src,
    followers: parciaParseCount(followers),
    following: parciaParseCount(text('[data-e2e="following-count"]')),
    likes: parciaParseCount(text('[data-e2e="likes-count"]')),
    profile: parciaCompact({ biography: text('[data-e2e="user-bio"]') }),
  };
}

async function parciaTiktokProfile() {
  const handle = parciaTiktokHandle();
  if (!handle) return null;

  const read = () => parciaTiktokProfileFromHydration(document, handle) ?? parciaTiktokProfileFromDom(handle);
  let data = await parciaRetry(read, 6);

  if (!data) {
    const page = await parciaFetchCurrentPage();
    data = page ? parciaTiktokProfileFromHydration(page, handle) : null;
  }
  if (!data) return null;

  return {
    kind: "creator",
    payload: parciaCompact({
      source: "tiktok",
      platform: "tiktok",
      username: handle,
      profile_url: `https://www.tiktok.com/@${handle}`,
      ...data,
    }),
  };
}

function parciaTiktokVideoFromRoot(root, videoId) {
  const item = parciaTiktokHydration(root)?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  return item && String(item.id) === videoId ? item : null;
}

// `hintItem`: the video as TikTok's own API returned it, captured by
// content/tiktok-interceptor.js — the only source when the video is open as an
// overlay (from a profile, For You or search), where the page HTML still
// belongs to the page the user came from.
async function parciaTiktokVideo(hintItem) {
  const match = location.pathname.match(/^\/@([^/]+)\/(?:video|photo)\/(\d+)/);
  if (!match) return null;
  const [, handle, videoId] = match;

  let item = hintItem && String(hintItem.id) === videoId ? hintItem : null;

  // The hydration script only holds the video of the first full page load;
  // after SPA navigation it belongs to another one, so the id must match.
  if (!item) item = await parciaRetry(() => parciaTiktokVideoFromRoot(document, videoId), 3);
  if (!item) {
    const page = await parciaFetchCurrentPage();
    item = page ? parciaTiktokVideoFromRoot(page, videoId) : null;
  }
  if (!item) return null;

  const stats = item.statsV2 ?? item.stats ?? {};
  return {
    kind: "publication",
    payload: parciaCompact({
      platform: "tiktok",
      platform_id: videoId,
      url: `https://www.tiktok.com/@${handle}/video/${videoId}`,
      creator_username: item.author?.uniqueId ?? handle,
      views: parciaParseCount(stats.playCount),
      likes: parciaParseCount(stats.diggCount),
      comments: parciaParseCount(stats.commentCount),
      shares: parciaParseCount(stats.shareCount),
      bookmarks: parciaParseCount(stats.collectCount),
      description: item.desc ? String(item.desc).slice(0, 5000) : null,
    }),
    display: { title: item.author?.nickname ?? `@${handle}`, avatar_url: item.author?.avatarThumb },
  };
}

globalThis.__parciaScrape = async (hints = {}) =>
  /\/(?:video|photo)\/\d+/.test(location.pathname) ? parciaTiktokVideo(hints.tiktokItem) : parciaTiktokProfile();
