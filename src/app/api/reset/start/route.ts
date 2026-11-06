import type { NextRequest } from "next/server";
import { db } from "@/server/db.ts";
import { startEmailCode } from "@/server/email-flow.ts";
import { fail, ok, readJson } from "@/server/http.ts";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  // Unknown addresses get the same answer and no mail.
  const result = await startEmailCode("reset", body.email, (email) => Boolean(db().prepare("SELECT 1 FROM users WHERE email = ?").get(email)));
  return result.error ? fail(result.status, result.error) : ok();
}
