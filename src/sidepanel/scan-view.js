import { PLATFORM_LABELS } from "../lib/pages.js";

// Renders the scanner card. Pure DOM (textContent only: scraped text is
// never parsed as HTML).

const el = {
  message: document.getElementById("scan-message"),
  result: document.getElementById("scan-result"),
  avatar: document.getElementById("scan-avatar"),
  title: document.getElementById("scan-title"),
  subtitle: document.getElementById("scan-subtitle"),
  stats: document.getElementById("scan-stats"),
  description: document.getElementById("scan-description"),
  descriptionToggle: document.getElementById("btn-description-toggle"),
  status: document.getElementById("scan-status"),
  rescan: document.getElementById("btn-rescan"),
  upgrade: document.getElementById("link-upgrade"),
};

const compact = new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 });

// Long descriptions start collapsed; "Ver más" only appears when they overflow.
function showDescription(text) {
  el.description.textContent = text ?? "";
  el.description.hidden = !el.description.textContent;
  el.description.classList.add("collapsed");
  el.descriptionToggle.textContent = "Ver más";
  el.descriptionToggle.hidden = true;

  if (!el.description.hidden) {
    requestAnimationFrame(() => {
      el.descriptionToggle.hidden = el.description.scrollHeight <= el.description.clientHeight + 1;
    });
  }
}

el.descriptionToggle.addEventListener("click", () => {
  const collapsed = el.description.classList.toggle("collapsed");
  el.descriptionToggle.textContent = collapsed ? "Ver más" : "Ver menos";
});

function reset() {
  el.message.hidden = true;
  el.result.hidden = true;
  el.status.hidden = true;
  el.status.className = "small";
  el.rescan.hidden = true;
  el.upgrade.hidden = true;
}

function message(text, { retry = false, upgrade = false } = {}) {
  reset();
  el.message.textContent = text;
  el.message.hidden = false;
  el.rescan.textContent = "Reintentar";
  el.rescan.hidden = !retry;
  el.upgrade.hidden = !upgrade;
}

export function renderIdle() {
  message("Abre el perfil de un creador o una publicación de TikTok o Instagram para ver sus métricas.");
}

export function renderScanning(page) {
  message(page.kind === "creator" ? "Escaneando creador…" : "Escaneando publicación…");
}

export function renderModuleDenied(platform) {
  message(`Tu plan no incluye ${PLATFORM_LABELS[platform] ?? platform}. Mejora tu plan para escanear esta plataforma.`, { upgrade: true });
}

export function renderQuotaExceeded(quota) {
  const resets = quota?.resets_at
    ? ` Se reinicia el ${new Date(quota.resets_at).toLocaleDateString("es", { day: "numeric", month: "short" })}.`
    : "";
  message(`Alcanzaste el límite de escaneos de tu plan este mes.${resets}`, { upgrade: true });
}

export function renderUnreadable() {
  message("No pudimos leer los datos de esta página. Espera a que termine de cargar y pulsa Reintentar.", { retry: true });
}

export function renderFailure() {
  message("No se pudo conectar con Parcia. Revisa tu conexión y pulsa Reintentar.", { retry: true });
}

function stat(label, value) {
  if (value === undefined || value === null) return null;
  const wrapper = document.createElement("div");
  const dt = Object.assign(document.createElement("dt"), { textContent: label });
  const dd = Object.assign(document.createElement("dd"), { textContent: compact.format(value), title: value.toLocaleString("es") });
  wrapper.append(dt, dd);
  return wrapper;
}

// Shown only after the API accepted the scan (it counted, or was a free re-scan).
export function renderResult(scraped, response) {
  reset();
  const p = scraped.payload;
  const platform = PLATFORM_LABELS[p.platform] ?? p.platform;

  let avatar;
  let rows;
  let description;
  if (scraped.kind === "creator") {
    avatar = p.avatar_url;
    el.title.textContent = p.display_name || `@${p.username}`;
    el.subtitle.textContent = `@${p.username} · ${platform}`;
    rows = [
      stat("Seguidores", p.followers),
      stat("Siguiendo", p.following),
      stat("Likes", p.likes),
      stat("Publicaciones", p.posts_count),
    ];
    description = p.profile?.biography;
  } else {
    avatar = scraped.display?.avatar_url;
    el.title.textContent = scraped.display?.title ?? (p.creator_username ? `@${p.creator_username}` : platform);
    el.subtitle.textContent = `Publicación de ${platform}`;
    rows = [
      stat("Vistas", p.views),
      stat("Likes", p.likes),
      stat("Comentarios", p.comments),
      stat("Compartidos", p.shares),
      stat("Guardados", p.bookmarks),
    ];
    description = p.description;
  }

  el.avatar.hidden = !avatar;
  if (avatar) el.avatar.src = avatar;
  el.stats.replaceChildren(...rows.filter(Boolean));
  el.result.hidden = false;
  showDescription(description); // after the card is visible, so it can be measured

  const remaining = response.remaining_quota;
  if (response.counted) {
    el.status.textContent = remaining === null
      ? "Escaneo registrado."
      : `Escaneo registrado · te quedan ${remaining} este mes.`;
    el.status.classList.add("status-ok");
  } else {
    el.status.textContent = "Ya lo escaneaste este mes · no consumió cuota.";
  }
  el.status.hidden = false;

  el.rescan.textContent = "Volver a escanear";
  el.rescan.hidden = false;
}

export function onRescan(handler) {
  el.rescan.addEventListener("click", handler);
}

export function setUpgradeUrl(url) {
  el.upgrade.href = url;
}
