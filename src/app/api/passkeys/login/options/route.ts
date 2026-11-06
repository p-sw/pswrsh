import type { NextRequest } from "next/server";
import { fail, ok } from "@/server/http.ts";
import { authenticationOptions, relyingParty } from "@/server/passkeys.ts";

export async function POST(request: NextRequest) {
  const rp = relyingParty(request.headers.get("origin"));
  if (!rp) return fail(400, "passkey_origin");
  return ok({ options: await authenticationOptions(rp) });
}
