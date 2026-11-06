import type { NextRequest } from "next/server";
import { issueCode, withdrawCode } from "@/server/codes.ts";
import { db, normalizeEmail } from "@/server/db.ts";
import { sendCodeMail } from "@/server/email-flow.ts";
import { clientIp, currentUser, fail, ok, readJson } from "@/server/http.ts";
import { confirmPassword } from "@/server/login.ts";
import { describeMailError } from "@/server/mail.ts";

export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) return fail(400, "bad_email");
  const check = await confirmPassword(user.id, body.password, clientIp(request));
  if (check !== "ok") return fail(check === "too_many_attempts" ? 429 : 403, check);
  if (email === user.email) return fail(400, "same_email");
  if (db().prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return fail(409, "email_taken");
  // The code belongs to this account and this new address together.
  const key = `${user.id} ${email}`;
  const code = issueCode("email_change", key);
  if (!code) return fail(429, "too_soon");
  try {
    await sendCodeMail("email_change", email, code);
  } catch (error) {
    withdrawCode("email_change", key);
    console.error(`[pswrsh] email change mail failed: ${describeMailError(error)}`);
    return fail(502, "mail_failed");
  }
  return ok();
}
