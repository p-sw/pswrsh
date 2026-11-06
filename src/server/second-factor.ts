// The second login step after a correct password.
import { checkCode, dropTicket, failTicket, issueCode, peekTicket, withdrawCode } from "./codes.ts";
import { db } from "./db.ts";
import { sendCodeMail } from "./email-flow.ts";
import { type SecondFactor, secondFactorsOf } from "./login.ts";
import { describeMailError } from "./mail.ts";

type Pending = { ticketId: number; userId: number; email: string; methods: SecondFactor[] };

export function pendingLogin(ticket: unknown): Pending | null {
  const found = peekTicket("login", ticket);
  if (!found) return null;
  const user = db().prepare("SELECT id FROM users WHERE email = ?").get(found.email) as { id: number } | undefined;
  if (!user) return null;
  return { ticketId: found.id, userId: user.id, email: found.email, methods: secondFactorsOf(user.id) };
}

export async function mailLoginCode(pending: Pending): Promise<string | null> {
  if (!pending.methods.includes("email")) return "method_unavailable";
  const code = issueCode("login", pending.email);
  if (!code) return "too_soon";
  try {
    await sendCodeMail("login", pending.email, code);
  } catch (error) {
    withdrawCode("login", pending.email);
    console.error(`[pswrsh] login code mail failed: ${describeMailError(error)}`);
    return "mail_failed";
  }
  return null;
}

/** Checks one answer. Wrong answers count against the ticket; 5 end it. */
export function checkSecondFactor(
  pending: Pending,
  method: unknown,
  code: unknown,
  verifyTotp: (userId: number, code: unknown) => boolean,
): "ok" | "method_unavailable" | "code_invalid" | "ticket_expired" {
  if (method !== "email" && method !== "totp") return "method_unavailable";
  if (!pending.methods.includes(method)) return "method_unavailable";
  const passed = method === "email" ? checkCode("login", pending.email, code) === "ok" : verifyTotp(pending.userId, code);
  if (passed) {
    dropTicket(pending.ticketId);
    return "ok";
  }
  return failTicket(pending.ticketId) ? "code_invalid" : "ticket_expired";
}
