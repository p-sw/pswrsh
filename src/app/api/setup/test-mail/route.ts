import type { NextRequest } from "next/server";
import { normalizeEmail } from "@/server/db.ts";
import { fail, ok, readJson } from "@/server/http.ts";
import { describeMailError, parseSmtp, sendMail, smtpFingerprint } from "@/server/mail.ts";
import { checkSetupToken, isSetupComplete, recordSmtpCheck } from "@/server/setup.ts";

export async function POST(request: NextRequest) {
  if (isSetupComplete()) return fail(404, "not_available");
  const body = await readJson(request);
  if (!checkSetupToken(body.token)) return fail(403, "bad_token");
  const to = normalizeEmail(body.email);
  const smtp = parseSmtp(body.smtp);
  if (!to) return fail(400, "bad_email");
  if (!smtp) return fail(400, "bad_smtp");
  try {
    await sendMail(smtp, {
      to,
      subject: "pswrsh 테스트 메일",
      text: "pswrsh 셋업에서 보낸 테스트 메일입니다. 이 메일이 왔다면 SMTP 설정이 맞습니다.",
    });
  } catch (error) {
    return fail(502, `smtp_failed:${describeMailError(error)}`);
  }
  recordSmtpCheck(smtpFingerprint(smtp));
  return ok();
}
