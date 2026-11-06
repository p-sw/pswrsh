import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { NextRequest } from "next/server";
import { fail, ok, readJson, startSession } from "@/server/http.ts";
import { authenticatePasskey, relyingParty } from "@/server/passkeys.ts";

/** A passkey with user verification logs in without a password or second factor. */
export async function POST(request: NextRequest) {
  const rp = relyingParty(request.headers.get("origin"));
  if (!rp) return fail(400, "passkey_origin");
  const body = await readJson(request);
  let userId: number | null = null;
  try {
    userId = await authenticatePasskey(rp, body.response as AuthenticationResponseJSON);
  } catch {
    userId = null;
  }
  return userId === null ? fail(401, "passkey_failed") : startSession(request, ok(), userId);
}
