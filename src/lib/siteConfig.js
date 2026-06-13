// Front-end single source of truth for the public app base URL.
//
// The front-end is a separate Vite build and cannot import from api/_lib, so this
// mirrors the backend's api/_lib/microsite.js PUBLIC_APP_BASE. Env-overridable
// (VITE_PUBLIC_APP_BASE) with the production host as the default — with no env var
// set the value is byte-for-byte identical to the literal these views used before.
//
// Used to build public microsite / share / copy-link URLs (e.g. `${PUBLIC_APP_BASE}/p/${slug}`).
// Do NOT use this for the auth subdomain (auth.milestonemediaphotography.com) or
// the marketing site — those are intentionally separate.
export const PUBLIC_APP_BASE =
  import.meta.env.VITE_PUBLIC_APP_BASE || "https://app.milestonemediaphotography.com";
