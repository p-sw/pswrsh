import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { NextRequest } from "next/server";
import { currentUser, fail, ok, readJson } from "@/server/http.ts";
import { registerPasskey, relyingParty } from "@/server/passkeys.ts";

export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const rp = relyingParty(request.headers.get("origin"));
  if (!rp) return fail(400, "passkey_origin");
  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) return fail(400, "bad_name");
  try {
    const saved = await registerPasskey(rp, user.id, name, body.response as RegistrationResponseJSON);
    return saved ? ok() : fail(400, "passkey_failed");
  } catch {
    return fail(400, "passkey_failed");
  }
}
