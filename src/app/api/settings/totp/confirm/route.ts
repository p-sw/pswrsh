import type { NextRequest } from "next/server";
import { currentUser, fail, ok, readJson } from "@/server/http.ts";
import { confirmTotp } from "@/server/totp.ts";

export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  return confirmTotp(user.id, body.code) ? ok() : fail(400, "code_invalid");
}
