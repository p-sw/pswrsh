import { NextResponse, type NextRequest } from "next/server";
import { ensureSetupToken, isSetupComplete } from "./server/setup.ts";

const SETUP_PATHS = ["/setup", "/api/setup"];

function under(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

function deny(request: NextRequest, to: string, status: number) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "not_available" }, { status });
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
  return NextResponse.next();
}

export const config = {
  // Static assets and the gateway WebSocket do not go through account checks here.
  matcher: ["/((?!_next/|ws$|favicon\\.ico$|.*\\.(?:svg|png|ico|txt)$).*)"],
};
