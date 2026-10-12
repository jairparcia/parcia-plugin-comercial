// Base URL of parcia-control-comercial per environment.
// The environment is chosen at build/load time, never by the end user.
// Use exactly the host of the app's GOOGLE_REDIRECT_URI: localhost and
// 127.0.0.1 are different sites with different session cookies, and the
// sign-in would come back to a session that does not know about the plugin.
export const ENVIRONMENTS = {
  local: "http://127.0.0.1:8000",
  staging: "", // TODO: staging URL
  production: "", // TODO: production URL
};

export const ENVIRONMENT = "local";

export const API_BASE_URL = ENVIRONMENTS[ENVIRONMENT];
