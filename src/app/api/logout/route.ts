import type { NextRequest } from "next/server";
import { clearSessionCookie, ok } from "@/server/http.ts";
import { deleteSession, SESSION_COOKIE } from "@/server/sessions.ts";

export async function POST(request: NextRequest) {
  deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
  return clearSessionCookie(request, ok());
}
