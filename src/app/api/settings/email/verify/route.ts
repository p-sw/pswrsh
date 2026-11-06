import type { NextRequest } from "next/server";
import { checkCode } from "@/server/codes.ts";
import { db, normalizeEmail } from "@/server/db.ts";
import { currentUser, fail, ok, readJson } from "@/server/http.ts";

export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) return fail(400, "bad_email");
  const result = checkCode("email_change", `${user.id} ${email}`, body.code);
  if (result !== "ok") return fail(400, result === "expired" ? "code_expired" : "code_invalid");
  try {
    db().prepare("UPDATE users SET email = ? WHERE id = ?").run(email, user.id);
  } catch {
    return fail(409, "email_taken");
  }
  return ok({ email });
}
