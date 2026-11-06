import type { NextRequest } from "next/server";
import { currentUser, fail, ok } from "@/server/http.ts";
import { beginTotp, otpauthUri } from "@/server/totp.ts";

/** Shows the setup key once. TOTP turns on only after a code from the app confirms it. */
export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const secret = beginTotp(user.id);
  return ok({ secret, uri: otpauthUri(user.email, secret) });
}
