import type { NextRequest } from "next/server";
import { verifyEmailCode } from "@/server/email-flow.ts";
import { fail, ok, readJson } from "@/server/http.ts";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const result = verifyEmailCode("reset", body.email, body.code);
  return "ticket" in result ? ok({ ticket: result.ticket }) : fail(result.status, result.error);
}
