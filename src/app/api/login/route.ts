import type { NextRequest } from "next/server";
import { clientIp, fail, ok, readJson, startSession } from "@/server/http.ts";
import { login } from "@/server/login.ts";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const result = await login(body.email, body.password, clientIp(request));
  if ("error" in result) return fail(result.error === "too_many_attempts" ? 429 : 401, result.error);
  return startSession(request, ok(), result.userId);
}
