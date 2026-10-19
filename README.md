# Parcia Plugin (commercial)

Chrome extension (Manifest V3) that connects to **parcia-control-comercial**.
This is the new plugin, built from scratch: sign-in plus the TikTok/Instagram
scanner. Styles are temporary until the MVP design arrives.

## Structure

```
src/
├── manifest.json     MV3 manifest. "key" pins the dev extension id.
├── config.js         API base URL per environment.
├── background.js     Service worker: opens the side panel on icon click, runs every auth action.
├── lib/
│   ├── auth.js       Sign-in in a new tab (PKCE), sign-out, account.
│   ├── api.js        fetch wrapper with the bearer token.
│   ├── session.js    Token storage (chrome.storage.local).
│   ├── pages.js      Which URLs are scannable (TikTok/Instagram profile or post).
│   └── scanner.js    Injects the scrapers into the tab and sends the scan to the API.
├── content/          tiktok-interceptor.js: keeps TikTok API video JSON in the page (world MAIN).
├── scrapers/         Run inside the TikTok/Instagram tab (isolated world):
│                     common.js helpers + tiktok.js / instagram.js.
├── sidepanel/        Side panel UI: sign-in, account, scanner card (scan-view.js).
├── auth/             Sign-in callback page (end of the sign-in tab).
└── icons/
```

## Scanner

- Works while the side panel is open and the user is signed in. Navigating with
  the panel closed scans nothing.
- On a TikTok or Instagram **profile** (`/@handle`, `/handle/`) or **post**
  (`/@handle/video/<id>`, `/p/<code>`, `/reel/<code>`), the panel injects
  `scrapers/common.js` + the platform scraper, reads the page and sends the
  result to `POST /api/ingest/creator` or `/api/ingest/publication`.
- The API decides: the plan's module for the platform (403) and the monthly
  quota of the account (402). A creator/post already scanned this month is a
  free re-scan (`counted: false`). The panel only shows the data once the API
  accepted the scan, and updates the quota from the response.
- Each scraper only returns data tied to the handle / id in the URL (TikTok and
  Instagram are SPAs: right after navigating, the DOM may still show the
  previous page). It retries for a few seconds and, as a last resort, refetches
  the page's server-rendered HTML.
- **TikTok videos opened as an overlay** (from a profile, For You or search)
  change the URL but keep the previous page's HTML, so their metrics only
  exist in the JSON TikTok's web app fetched. `content/tiktok-interceptor.js`
  (content script, world MAIN, `document_start`) keeps every video-shaped
  object from any TikTok `/api/` response in a page-memory map (max 1000, no
  storage, nothing leaves the page). The scanner reads it by the video id in
  the URL; hydration / refetching the page are the fallback. After installing
  or reloading the extension, reload open TikTok tabs so the interceptor runs.
- Results are cached per page for the panel session; "Volver a escanear"
  forces a new scan.
- Modash is not scanned yet.

## Sign-in flow

1. The side panel asks the background worker to sign in. The worker stores a
   PKCE `verifier` and a random `state` in `chrome.storage.session` (the user
   may take minutes and Chrome can stop the worker meanwhile).
2. The worker opens `{API}/plugin/connect` in a **new tab**, sending
   `redirect_uri` (`chrome-extension://<extension-id>/auth/callback.html`), the
   PKCE `code_challenge`, the `state` and a device name.
3. In the web app, the user signs in with Google if needed and clicks **Connect**.
   The app redirects that tab to `auth/callback.html?code=…&state=…`. This page
   is listed in `web_accessible_resources` for the API origin, so the web app
   can navigate to it.
4. The callback page hands the code to the worker. The worker checks `state`,
   exchanges `code` + `code_verifier` at `POST /api/plugin/token` and stores the
   token in `chrome.storage.local`. The tab then moves on to the web app's
   `/plugin/connected` confirmation page (with a "Go to dashboard" button), and
   the side panel updates by itself. Cancelling closes the tab and returns to
   the tab where the user started.
5. Every API call sends `Authorization: Bearer <token>`. A 401 drops the token,
   for example after the device was disconnected from the portal.

When adding the staging/production URLs to `src/config.js`, also add their
origins to `web_accessible_resources[].matches` in `manifest.json`.

## Local setup

1. In parcia-control-comercial `.env`, allow this extension id:
   ```
   PLUGIN_EXTENSION_IDS=cndkebmcjlfnceoplmnaopgifhnjaddo
   ```
   The id is fixed by `key` in `manifest.json`, so it is the same on every machine.
2. Check `src/config.js`: `ENVIRONMENT = "local"` points to `http://127.0.0.1:8000`.
   It must use **the same host** as the app's `GOOGLE_REDIRECT_URI`
   (`localhost` and `127.0.0.1` have separate session cookies; mixing them
   sends the user to the dashboard instead of back to the plugin sign-in).
3. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and select the `src/` folder.
4. Click the extension icon: the side panel opens on the right. Click **Iniciar sesión con Google**.

## Publishing (later)

The Chrome Web Store assigns its own id. Add that id to `PLUGIN_EXTENSION_IDS`
(comma separated) on staging and production, and set the `staging` and
`production` URLs in `src/config.js`.
