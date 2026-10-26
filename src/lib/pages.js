// Which TikTok / Instagram pages can be scanned, from the tab URL alone.
// Returns null for anything else (feeds, search, settings…).

const INSTAGRAM_SECTIONS = new Set([
  "explore", "reels", "reel", "p", "tv", "stories", "direct", "accounts",
  "about", "developer", "legal", "web", "challenge", "emails", "session",
]);

export const PLATFORM_LABELS = { tiktok: "TikTok", instagram: "Instagram" };

function tiktok(path) {
  const video = path.match(/^\/@([^/]+)\/(?:video|photo)\/(\d+)/);
  if (video) {
    return { platform: "tiktok", kind: "publication", key: `tiktok:publication:${video[2]}` };
  }

  const profile = path.match(/^\/@([^/?#]+)\/?$/);
  if (profile) {
    return { platform: "tiktok", kind: "creator", key: `tiktok:creator:${profile[1].toLowerCase()}` };
  }

  return null;
}

function instagram(path) {
  const post = path.match(/^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/?#]+)/);
  if (post) {
    return { platform: "instagram", kind: "publication", key: `instagram:publication:${post[1]}` };
  }

  // /handle/, /handle/reels/, /handle/tagged/ are all the profile.
  const profile = path.match(/^\/([^/?#]+)\/?(?:reels\/?|tagged\/?)?$/);
  if (profile && !INSTAGRAM_SECTIONS.has(profile[1].toLowerCase())) {
    return { platform: "instagram", kind: "creator", key: `instagram:creator:${profile[1].toLowerCase()}` };
  }

  return null;
}

export function classifyPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname === "www.tiktok.com" || parsed.hostname === "tiktok.com") return tiktok(parsed.pathname);
  if (parsed.hostname === "www.instagram.com" || parsed.hostname === "instagram.com") return instagram(parsed.pathname);

  return null;
}
