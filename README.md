# Parcia Plugin (commercial)

Chrome extension (Manifest V3) that connects to **parcia-control-comercial**.
This is the new plugin, built from scratch. For now it only covers sign-in;
scanning arrives with the MVP design.

## Structure

```
src/
├── manifest.json     MV3 manifest. "key" pins the dev extension id.
├── config.js         API base URL per environment.
├── background.js     Service worker: opens the side panel on icon click, runs every auth action.
├── lib/
│   ├── auth.js       Sign-in in a new tab (PKCE), sign-out, account.
│   ├── api.js        fetch wrapper with the bearer token.
│   └── session.js    Token storage (chrome.storage.local).
├── sidepanel/        Side panel UI (signed out / signed in).
├── auth/             Sign-in callback page (end of the sign-in tab).
└── icons/
```

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
