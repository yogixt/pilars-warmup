import { NextRequest, NextResponse } from "next/server";
import { authEnabled, authToken, AUTH_COOKIE } from "./lib/auth-token";

// Paths that must stay public (they carry their own auth or are needed to log in).
function isPublic(path: string): boolean {
  if (path.startsWith("/api/auth")) return true; // login/logout
  if (path.startsWith("/api/cron")) return true; // protected by CRON_SECRET
  if (path.startsWith("/api/webhooks")) return true; // protected by its own key
  if (path === "/login") return true;
  return false;
}

export async function middleware(req: NextRequest) {
  // Auth disabled (no password set) -> app stays open (local dev before setup).
  if (!authEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const expected = await authToken();
  if (cookie && cookie === expected) return NextResponse.next();

  // Unauthenticated: 401 for APIs, redirect to /login for pages.
  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
