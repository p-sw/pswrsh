// The three steps shared by signup and password reset: send a code, verify it, finish.
import { normalizeEmail } from "./db.ts";
import { checkCode, type CodePurpose, issueCode, issueTicket, withdrawCode } from "./codes.ts";
import { describeMailError, sendSystemMail } from "./mail.ts";

const SUBJECTS: Record<CodePurpose, string> = {
  signup: "pswrsh 가입 확인 코드",
  reset: "pswrsh 비밀번호 재설정 코드",
  email_change: "pswrsh 이메일 변경 확인 코드",
  login: "pswrsh 로그인 확인 코드",
};

/** Mails a code. Errors carry no SMTP secrets. */
export async function sendCodeMail(purpose: CodePurpose, to: string, code: string) {
  await sendSystemMail({
    to,
    subject: SUBJECTS[purpose],
    text: `확인 코드: ${code}\n\n10분 동안 쓸 수 있습니다. 요청하지 않았다면 이 메일을 무시하세요.`,
  });
}

export type StartResult = { status: 200 | 400 | 429 | 502; error?: string };

/**
 * Sends a code when `deliver` is true. When it is false (no account to reset, or the
 * address is already registered) the answer looks the same, so addresses do not leak.
 */
export async function startEmailCode(purpose: CodePurpose, rawEmail: unknown, deliver: (email: string) => boolean): Promise<StartResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { status: 400, error: "bad_email" };
  const code = issueCode(purpose, email);
  if (!code) return { status: 429, error: "too_soon" };
  if (!deliver(email)) return { status: 200 };
  try {
    await sendCodeMail(purpose, email, code);
  } catch (error) {
    withdrawCode(purpose, email);
    console.error(`[pswrsh] ${purpose} mail failed: ${describeMailError(error)}`);
    return { status: 502, error: "mail_failed" };
  }
  return { status: 200 };
}

export function verifyEmailCode(purpose: CodePurpose, rawEmail: unknown, code: unknown) {
  const email = normalizeEmail(rawEmail);
  if (!email) return { status: 400 as const, error: "bad_email" };
  const result = checkCode(purpose, email, code);
  if (result === "ok") return { status: 200 as const, ticket: issueTicket(purpose, email) };
  return { status: 400 as const, error: result === "expired" ? "code_expired" : "code_invalid" };
}
