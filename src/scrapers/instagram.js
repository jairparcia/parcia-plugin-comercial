// Instagram scraper (needs common.js), ported from parcia-plugin. Returns the
// API payload for the current page, or null when the page cannot be read as
// the URL's own profile/post. Sources, each tied to the handle or shortcode
// in the URL so a stale SPA fragment is never sent:
//   1. <head> meta (og:*) + JSON-LD ProfilePage
//   2. the visible <header> counters (live, win over og) — only when the
//      header shows the URL handle
//   3. embedded JSON, only if user.username === the URL handle

// Top-level path segments that are Instagram sections, not usernames.
// (A function, not a top-level const: the file may be injected twice.)
function parciaIgIsReserved(segment) {
  return [
    "explore", "reels", "reel", "p", "tv", "stories", "direct", "accounts",
    "about", "developer", "legal", "web", "challenge", "emails", "session",
  ].includes(segment.toLowerCase());
}

function parciaIgHandle() {
  const first = location.pathname.split("/").filter(Boolean)[0];
  return first && !parciaIgIsReserved(first) ? first : null;
}

// Source 1
function parciaIgFromHead(root, handle) {
  const out = { identityOk: false };
  const want = handle.toLowerCase();
  const meta = (name) =>
    root.querySelector(`meta[property="${name}"]`)?.content ||
    root.querySelector(`meta[name="${name}"]`)?.content ||
    null;

  const ogTitle = meta("og:title");
  const ogDesc = meta("og:description");
  const ogImage = meta("og:image");

  if (ogTitle) {
    const m = ogTitle.match(/^(.*?)\s*\(@([^)]+)\)/);
    if (m) {
      if (m[2].toLowerCase() === want) out.identityOk = true;
      if (m[1].trim()) out.full_name = m[1].trim();
    }
  }

  if (ogDesc) {
    // "165K Followers, 62 Following, 1,611 Posts - ..." — 3 numbers, in order.
    const head = ogDesc.split(/\s[-–—]\s/)[0];
    const nums = head.match(/\d[\d.,\s ]*\d*\s*(?:mil|mill\.?|millones?|k|m|b)?/gi);
    if (nums && nums.length >= 3) {
      out.followers = parciaParseCount(nums[0]);
      out.following = parciaParseCount(nums[1]);
      out.posts_count = parciaParseCount(nums[2]);
    }
    if (!out.identityOk && new RegExp("@" + handle.replace(/\./g, "\\.") + "\\b", "i").test(ogDesc)) {
      out.identityOk = true;
    }
  }

  if (ogImage) out.photo = ogImage;

  root.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    let ld;
    try {
      ld = JSON.parse(s.textContent || "");
    } catch (e) {
      return;
    }

    (Array.isArray(ld) ? ld : [ld]).forEach((node) => {
      if (!node || typeof node !== "object") return;
      const id = node["@id"] || node.mainEntityofPage?.["@id"] || "";
      const alt = String(node.alternateName || node.author?.alternateName || "").replace("@", "").toLowerCase();
      if (!((typeof id === "string" && id.toLowerCase().includes("/" + want)) || alt === want)) return;

      out.identityOk = true;
      const name = node.name || node.author?.name;
      if (name && !out.full_name) out.full_name = String(name);
    });
  });

  return out;
}

// Source 2 — reads the header's flattened text (Instagram changes its markup often).
function parciaIgFromHeader(handle) {
  const header = document.querySelector("main header") || document.querySelector("header");
  if (!header) return null;

  const text = header.innerText || header.textContent || "";
  const tokens = text.toLowerCase().split(/\s+/);
  if (!tokens.includes(handle.toLowerCase())) return null; // still the previous profile

  const NUM = "(\\d[\\d.,\\u00a0 ]*\\d|\\d)\\s*(mil|mill\\.?|millones?|k|m|b)?";
  const grab = (labelRe) => {
    const m = text.match(new RegExp(NUM + "\\s*(?:" + labelRe + ")\\b", "i"));
    return m ? parciaParseCount((m[1] + (m[2] ? " " + m[2] : "")).trim()) : null;
  };

  const out = {
    posts_count: grab("publicaciones|publicaci[oó]n|posts|post"),
    followers: grab("seguidores|followers|seguidor(?:es)?"),
    following: grab("seguidos|seguidas|siguiendo|following"),
  };

  // Exact counts often sit in a title attribute ("165 K" shown, title="165,432").
  header.querySelectorAll("[title]").forEach((el) => {
    const t = el.getAttribute("title");
    if (!t || !/^[\d.,\s ]+$/.test(t)) return;
    const ctx = (el.closest("a, li, div, span")?.parentElement?.textContent || "").toLowerCase();
    if (/seguidores|followers/.test(ctx)) out.followers = parciaParseCount(t);
    else if (/seguidos|following/.test(ctx)) out.following = parciaParseCount(t);
  });

  return out.followers !== null ? out : null;
}

// Source 3
function parciaIgUserFromJson(root, handle) {
  const want = handle.toLowerCase();

  for (const script of root.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent || "";
    if (!text.includes('"username"') || text.toLowerCase().indexOf(want) === -1) continue;

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      continue;
    }

    const user = parciaFindNode(
      json,
      (n) =>
        typeof n.username === "string" &&
        n.username.toLowerCase() === want &&
        (n.edge_followed_by || n.follower_count !== undefined || n.biography !== undefined || n.full_name !== undefined)
    );
    if (user) return user;
  }

  return null;
}

function parciaIgProfileFrom(root, handle, useLiveHeader) {
  const head = parciaIgFromHead(root, handle);
  const header = useLiveHeader ? parciaIgFromHeader(handle) : null;
  const user = parciaIgUserFromJson(root, handle);

  // Only what is provably about this handle.
  if (!header && !user && !(head.identityOk && head.followers !== undefined)) return null;

  const data = {
    display_name: parciaPick(user?.full_name, head.full_name),
    avatar_url: parciaPick(user?.profile_pic_url_hd, user?.profile_pic_url, head.photo),
    followers: parciaPick(header?.followers, user?.edge_followed_by?.count, user?.follower_count, head.followers),
    following: parciaPick(header?.following, user?.edge_follow?.count, user?.following_count, head.following),
    posts_count: parciaPick(header?.posts_count, user?.edge_owner_to_timeline_media?.count, user?.media_count, head.posts_count),
    profile: {},
  };

  if (user) {
    data.profile = parciaCompact({
      full_name: user.full_name,
      instagram_user_id: user.id || user.pk ? String(user.id || user.pk) : null,
      biography: user.biography ? String(user.biography).slice(0, 5000) : null,
      external_url: user.external_url || user.bio_links?.[0]?.url,
      category_name: user.category_name || user.category_enum,
      is_verified: typeof user.is_verified === "boolean" ? user.is_verified : null,
      is_private: typeof user.is_private === "boolean" ? user.is_private : null,
      is_business_account: typeof user.is_business_account === "boolean" ? user.is_business_account : null,
      business_email: user.business_email,
      business_phone: user.business_phone_number,
      pronouns: Array.isArray(user.pronouns) ? user.pronouns.join("/") : user.pronouns,
      highlight_reel_count: user.highlight_reel_count,
    });
  }

  return data;
}

async function parciaIgProfile() {
  const handle = parciaIgHandle();
  if (!handle) return null;

  let data = await parciaRetry(() => parciaIgProfileFrom(document, handle, true), 6);
  if (!data) {
    const page = await parciaFetchCurrentPage();
    data = page ? parciaIgProfileFrom(page, handle, false) : null;
  }
  if (!data) return null;

  return {
    kind: "creator",
    payload: parciaCompact({
      source: "instagram",
      platform: "instagram",
      username: handle,
      profile_url: `https://www.instagram.com/${handle}/`,
      ...data,
      profile: Object.keys(data.profile).length ? data.profile : null,
    }),
  };
}

// Instagram embeds several shortcode_media-shaped blobs on a post page
// (related reels, carousel items): only the one with the URL's shortcode counts.
function parciaIgPostFromJson(root, shortcode) {
  for (const script of root.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent || "";
    if (!text.includes(shortcode)) continue;
    if (!text.includes("shortcode_media") && !text.includes("edge_media_preview_like") && !text.includes("like_count")) continue;

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      continue;
    }

    const media = parciaFindNode(
      json,
      (n) => (n.shortcode === shortcode || n.code === shortcode) &&
        (n.edge_media_preview_like || n.edge_liked_by || n.like_count !== undefined)
    );
    if (media) return media;
  }

  return null;
}

async function parciaIgPost() {
  const match = location.pathname.match(/^\/(?:([^/]+)\/)?(?:p|reel|reels|tv)\/([^/?#]+)/);
  if (!match) return null;
  const urlHandle = match[1] && !parciaIgIsReserved(match[1]) ? match[1] : null;
  const shortcode = match[2];

  let media = await parciaRetry(() => parciaIgPostFromJson(document, shortcode), 3);
  if (!media) {
    const page = await parciaFetchCurrentPage();
    media = page ? parciaIgPostFromJson(page, shortcode) : null;
  }
  if (!media) return null;

  const owner = media.owner?.username || media.user?.username || urlHandle;
  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text ?? media.caption?.text;

  return {
    kind: "publication",
    payload: parciaCompact({
      platform: "instagram",
      platform_id: shortcode,
      url: `https://www.instagram.com/p/${shortcode}/`,
      creator_username: owner,
      views: parciaParseCount(media.video_view_count ?? media.video_play_count ?? media.play_count ?? media.view_count),
      likes: parciaParseCount(media.edge_media_preview_like?.count ?? media.edge_liked_by?.count ?? media.like_count),
      comments: parciaParseCount(
        media.edge_media_to_parent_comment?.count ?? media.edge_media_to_comment?.count ?? media.comment_count
      ),
      description: caption ? String(caption).slice(0, 5000) : null,
    }),
    display: {
      title: owner ? `@${owner}` : "Instagram",
      avatar_url: media.owner?.profile_pic_url || media.user?.profile_pic_url,
    },
  };
}

globalThis.__parciaScrape = async () =>
  /\/(?:p|reel|reels|tv)\//.test(location.pathname) ? parciaIgPost() : parciaIgProfile();
