// Edge-safe auth helpers (Web Crypto only — works in middleware and node routes).
// Stateless: the session cookie value is sha256(user:password:secret). No store
// needed; changing the password invalidates all existing cookies.

export function authEnabled(): boolean {
  return Boolean(process.env.AUTH_PASSWORD);
}

export async function authToken(): Promise<string> {
  const raw = `${process.env.AUTH_USER || "admin"}:${process.env.AUTH_PASSWORD || ""}:${
    process.env.AUTH_SECRET || "pilars-warmup"
  }`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const AUTH_COOKIE = "pw_session";
