import { API_BASE_URL } from "../config.js";

// Landing page of the sign-in tab: the web app redirects here with
// ?code=…&state=… (or ?error=access_denied&state=…). The background worker
// finishes the sign-in; on success this tab moves on to the web app's
// "Plugin connected" page.
const status = document.getElementById("status");
const query = new URLSearchParams(location.search);

const params = {
  code: query.get("code"),
  state: query.get("state"),
  error: query.get("error"),
};

// Do not leave the code in this tab's URL / history.
history.replaceState(null, "", location.pathname);

const response = await chrome.runtime.sendMessage({ type: "auth:complete", params });

if (response.ok) {
  location.replace(`${API_BASE_URL}/plugin/connected`);
} else if (response.message === "access_denied") {
  status.textContent = "Conexión cancelada.";
} else {
  status.textContent = "No se pudo conectar el plugin. Cierra esta pestaña y vuelve a intentarlo desde el plugin.";
  status.classList.add("error");
}
