import type { NextRequest } from "next/server";
import { clearSessionCookie, ok } from "@/server/http.ts";
import { deleteSession, SESSION_COOKIE } from "@/server/sessions.ts";

export async function POST(request: NextRequest) {
  const gatewayPort = process.env.PSWRSH_GATEWAY_PORT ?? "3101";
  const cookie = request.headers.get("cookie");
  if (cookie) {
    await fetch(`http://127.0.0.1:${gatewayPort}/api/sessions/close-all`, {
      method: "POST",
      headers: { cookie },
    }).catch(() => undefined);
  }
  deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
  return clearSessionCookie(request, ok());
}
