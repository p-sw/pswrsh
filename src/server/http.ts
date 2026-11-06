// Helpers for the account route handlers.
import { NextResponse, type NextRequest } from "next/server";
import { createSession, findSession, SESSION_COOKIE } from "./sessions.ts";

/** Behind Cloudflare Tunnel the client address arrives in a header. Only loopback reaches the app. */
export function clientIp(request: NextRequest) {
  const forwarded =
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0];
  return forwarded?.trim() || "local";
}

/** HTTPS when the browser came in over HTTPS, including through the tunnel. */
export function isHttps(request: NextRequest) {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return request.nextUrl.protocol === "https:";
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export function ok(body: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...body });
}

export function startSession(request: NextRequest, response: NextResponse, userId: number) {
  const { token, maxAgeSeconds } = createSession(userId);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(request),
    path: "/",
    maxAge: maxAgeSeconds,
  });
  return response;
}

export function clearSessionCookie(request: NextRequest, response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(request),
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function currentUser(request: NextRequest) {
  return findSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export function sessionToken(request: NextRequest) {
  return request.cookies.get(SESSION_COOKIE)?.value;
}
