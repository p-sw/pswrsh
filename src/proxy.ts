import { NextResponse, type NextRequest } from "next/server";
import { findSession, SESSION_COOKIE } from "./server/sessions.ts";
import { ensureSetupToken, isSetupComplete } from "./server/setup.ts";

const SETUP_PATHS = ["/setup", "/api/setup"];
/** Reachable without a login. */
const PUBLIC_PATHS = ["/login", "/signup", "/forgot", "/api/login", "/api/logout", "/api/signup", "/api/reset"];
/** Pages a logged-in user has no use for. */
const LOGGED_OUT_PAGES = ["/login", "/signup", "/forgot"];

function under(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

function deny(request: NextRequest, to: string, status: number) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: status === 401 ? "login_required" : "not_available" }, { status });
  }
  return NextResponse.redirect(new URL(to, request.url));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isSetupComplete()) {
    ensureSetupToken();
    return under(pathname, SETUP_PATHS) ? NextResponse.next() : deny(request, "/setup", 503);
  }
  if (under(pathname, SETUP_PATHS)) return deny(request, "/", 404);

  const user = findSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (user && under(pathname, LOGGED_OUT_PAGES)) return NextResponse.redirect(new URL("/", request.url));
  if (!user && !under(pathname, PUBLIC_PATHS)) return deny(request, "/login", 401);
  return NextResponse.next();
}

export const config = {
  // Static assets and the gateway WebSocket do not go through account checks here.
  // The gateway checks the session cookie itself.
  matcher: ["/((?!_next/|ws$|favicon\\.ico$|.*\\.(?:svg|png|ico|txt)$).*)"],
};
