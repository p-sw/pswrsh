import type { NextRequest } from "next/server";
import { fail, ok, readJson, startSession } from "@/server/http.ts";
import { checkSecondFactor, pendingLogin } from "@/server/second-factor.ts";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const pending = pendingLogin(body.ticket);
  if (!pending) return fail(400, "ticket_expired");
  const result = checkSecondFactor(pending, body.method, body.code, () => false);
  if (result !== "ok") return fail(result === "ticket_expired" ? 400 : 401, result);
  return startSession(request, ok(), pending.userId);
}
