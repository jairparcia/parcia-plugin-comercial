// Shared helpers for the page scrapers. Injected with chrome.scripting into
// the extension's isolated world of the TikTok/Instagram tab, before the
// platform scraper. Function declarations only (no top-level const/let), so
// injecting the files again on the same page never throws.

// "1.2M", "165 K", "1,611", "3,5 mil", "2 millones" → integer.
function parciaParseCount(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Math.round(raw);

  let s = String(raw).trim().toLowerCase().replace(/[\s ]/g, "");
  s = s.replace(/millones?|mill\.?/g, "m").replace(/mil(?![a-z])/g, "k");

  const suffixMatch = s.match(/([kmb])$/);
  const suffix = suffixMatch ? suffixMatch[1] : "";
  let numPart = suffix ? s.slice(0, -1) : s;
  numPart = numPart.replace(/,/g, ".");

  if (suffix) {
    const parts = numPart.split(".");
    numPart = parts.length > 1 && parts[parts.length - 1].length <= 2
      ? parts.slice(0, -1).join("") + "." + parts[parts.length - 1]
      : parts.join("");
  } else {
    numPart = numPart.replace(/\./g, "");
  }

  let value = parseFloat(numPart);
  if (!isFinite(value)) {
    const digits = s.replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : null;
  }

  if (suffix === "k") value *= 1e3;
  else if (suffix === "m") value *= 1e6;
  else if (suffix === "b") value *= 1e9;

  return Math.round(value);
}

function parciaFindNode(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;

  for (const key of Object.keys(node)) {
    const found = parciaFindNode(node[key], predicate);
    if (found) return found;
  }

  return null;
}

function parciaPick(...values) {
  return values.find((v) => v !== undefined && v !== null && v !== "");
}

// Drops null/undefined/"" so the API only receives what was actually read.
function parciaCompact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, v]) => v !== null && v !== undefined && v !== "")
  );
}

// The SPA may still show the previous page right after navigating: retry a
// few times until the reader returns data for the current URL.
async function parciaRetry(read, attempts = 8, delayMs = 750) {
  for (let i = 0; i < attempts; i++) {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

// Fresh server-rendered HTML of the current URL (same origin, with the
// user's own session), for when the live DOM belongs to another page.
async function parciaFetchCurrentPage() {
  try {
    const response = await fetch(location.href, { credentials: "include" });
    if (!response.ok) return null;
    return new DOMParser().parseFromString(await response.text(), "text/html");
  } catch (e) {
    return null;
  }
}
