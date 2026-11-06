import type { NextRequest } from "next/server";
import { verifyEmailCode } from "@/server/email-flow.ts";
import { fail, ok, readJson } from "@/server/http.ts";
import { isSignupEnabled } from "@/server/setup.ts";

export async function POST(request: NextRequest) {
  if (!isSignupEnabled()) return fail(403, "signup_disabled");
  const body = await readJson(request);
  const result = verifyEmailCode("signup", body.email, body.code);
  return "ticket" in result ? ok({ ticket: result.ticket }) : fail(result.status, result.error);
}
