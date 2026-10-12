import { API_BASE_URL } from "../config.js";
import { clearToken, getToken } from "./session.js";

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.error ?? null;
    this.body = body;
  }
}

// Calls the parcia-control-comercial API with the stored token. A 401 means
// the session was signed out elsewhere (e.g. "Disconnect" in the portal), so
// the local token is dropped.
export async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = { Accept: "application/json" };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = await getToken();
    if (!token) {
      throw new ApiError(401, { error: "unauthenticated" });
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && auth) {
      await clearToken();
    }
    throw new ApiError(response.status, data);
  }

  return data;
}
