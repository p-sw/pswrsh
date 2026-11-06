import type { NextRequest } from "next/server";
import { db } from "@/server/db.ts";
import { startEmailCode } from "@/server/email-flow.ts";
import { fail, ok, readJson } from "@/server/http.ts";
import { isSignupEnabled } from "@/server/setup.ts";

export async function POST(request: NextRequest) {
  if (!isSignupEnabled()) return fail(403, "signup_disabled");
  const body = await readJson(request);
  const result = await startEmailCode("signup", body.email, (email) => !db().prepare("SELECT 1 FROM users WHERE email = ?").get(email));
  return result.error ? fail(result.status, result.error) : ok();
}
