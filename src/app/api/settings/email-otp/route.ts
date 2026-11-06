import type { NextRequest } from "next/server";
import { db } from "@/server/db.ts";
import { clientIp, currentUser, fail, ok, readJson } from "@/server/http.ts";
import { confirmPassword } from "@/server/login.ts";

/** Turns the email-code second factor on or off. Both need the current password. */
export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  if (typeof body.enabled !== "boolean") return fail(400, "bad_value");
  const check = await confirmPassword(user.id, body.password, clientIp(request));
  if (check !== "ok") return fail(check === "too_many_attempts" ? 429 : 403, check);
  db().prepare("UPDATE users SET email_otp = ? WHERE id = ?").run(body.enabled ? 1 : 0, user.id);
  return ok({ enabled: body.enabled });
}
