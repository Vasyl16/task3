/// <reference types="vite/client" />

// Opts out of Vite's default `Record<string, any>` fallback for
// import.meta.env, so only the keys declared below are valid/typed.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

// Only VITE_-prefixed vars are exposed to the browser bundle (Vite
// convention) — anything else in .env is invisible to client code and
// must never be relied on here.
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
}
