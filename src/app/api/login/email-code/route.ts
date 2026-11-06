import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/server/http.ts";
import { mailLoginCode, pendingLogin } from "@/server/second-factor.ts";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const pending = pendingLogin(body.ticket);
  if (!pending) return fail(400, "ticket_expired");
  const error = await mailLoginCode(pending);
  if (error) return fail(error === "too_soon" ? 429 : error === "mail_failed" ? 502 : 400, error);
  return ok();
}
