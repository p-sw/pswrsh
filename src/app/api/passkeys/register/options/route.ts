import type { NextRequest } from "next/server";
import { currentUser, fail, ok } from "@/server/http.ts";
import { registrationOptions, relyingParty } from "@/server/passkeys.ts";

export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const rp = relyingParty(request.headers.get("origin"));
  if (!rp) return fail(400, "passkey_origin");
  return ok({ options: await registrationOptions(rp, user) });
}
