import type { NextRequest } from "next/server";
import { clientIp, currentUser, fail, ok, readJson } from "@/server/http.ts";
import { confirmPassword } from "@/server/login.ts";
import { deletePasskey } from "@/server/passkeys.ts";

/** Deleting a passkey needs the current password. */
export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  const check = await confirmPassword(user.id, body.password, clientIp(request));
  if (check !== "ok") return fail(check === "too_many_attempts" ? 429 : 403, check);
  return deletePasskey(user.id, body.id) ? ok() : fail(404, "not_found");
}
