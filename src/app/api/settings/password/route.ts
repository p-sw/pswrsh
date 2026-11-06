import type { NextRequest } from "next/server";
import { db } from "@/server/db.ts";
import { clientIp, currentUser, fail, ok, readJson, sessionToken } from "@/server/http.ts";
import { confirmPassword } from "@/server/login.ts";
import { hashPassword, isAcceptablePassword } from "@/server/password.ts";
import { deleteOtherSessions } from "@/server/sessions.ts";

export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  if (!isAcceptablePassword(body.next)) return fail(400, "bad_password");
  const check = await confirmPassword(user.id, body.current, clientIp(request));
  if (check !== "ok") return fail(check === "too_many_attempts" ? 429 : 403, check);
  db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(body.next), user.id);
  // Other browsers that knew the old password are logged out; this one stays.
  deleteOtherSessions(user.id, sessionToken(request));
  return ok();
}
