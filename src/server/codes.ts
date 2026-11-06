// Six-digit email codes and the short-lived tickets that follow a verified code.
// A code lasts 10 minutes and dies after 5 wrong tries. One code per address per minute.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db, now } from "./db.ts";

export type CodePurpose = "signup" | "reset";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const TICKET_TTL_MS = 15 * 60 * 1000;

function hashCode(purpose: string, email: string, code: string) {
  return createHash("sha256").update(`${purpose}:${email}:${code}`).digest("hex");
}

function prune() {
  db().prepare("DELETE FROM one_time_codes WHERE expires_at < ?").run(now());
}

/** A new code for the address, or null when one was issued less than a minute ago. */
export function issueCode(purpose: CodePurpose, email: string): string | null {
  prune();
  const recent = db()
    .prepare("SELECT 1 FROM one_time_codes WHERE purpose = ? AND email = ? AND created_at > ?")
    .get(purpose, email, now() - RESEND_INTERVAL_MS);
  if (recent) return null;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const at = now();
  // Only the newest code counts.
  db().prepare("DELETE FROM one_time_codes WHERE purpose = ? AND email = ?").run(purpose, email);
  db()
    .prepare("INSERT INTO one_time_codes (purpose, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(purpose, email, hashCode(purpose, email, code), at, at + CODE_TTL_MS);
  return code;
}

/** Withdraws a code whose mail could not be sent, so the user can ask again at once. */
export function withdrawCode(purpose: CodePurpose, email: string) {
  db().prepare("DELETE FROM one_time_codes WHERE purpose = ? AND email = ?").run(purpose, email);
}

export type CodeCheck = "ok" | "invalid" | "expired";

export function checkCode(purpose: CodePurpose, email: string, code: unknown): CodeCheck {
  prune();
  const row = db()
    .prepare("SELECT id, code_hash, attempts FROM one_time_codes WHERE purpose = ? AND email = ?")
    .get(purpose, email) as { id: number; code_hash: string; attempts: number } | undefined;
  if (!row || row.attempts >= MAX_ATTEMPTS) return "expired";
  const given = Buffer.from(hashCode(purpose, email, typeof code === "string" ? code.trim() : ""));
  const expected = Buffer.from(row.code_hash);
  if (given.length === expected.length && timingSafeEqual(given, expected)) {
    db().prepare("DELETE FROM one_time_codes WHERE id = ?").run(row.id);
    return "ok";
  }
  db().prepare("UPDATE one_time_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
  return row.attempts + 1 >= MAX_ATTEMPTS ? "expired" : "invalid";
}

/** After a verified code, a ticket lets the next step set the password. */
export function issueTicket(purpose: CodePurpose, email: string) {
  const ticket = randomBytes(24).toString("base64url");
  const at = now();
  db()
    .prepare("INSERT INTO one_time_codes (purpose, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(`${purpose}_ticket`, email, createHash("sha256").update(ticket).digest("hex"), at, at + TICKET_TTL_MS);
  return ticket;
}

/** The address the ticket was issued for. Each ticket works once. */
export function consumeTicket(purpose: CodePurpose, ticket: unknown): string | null {
  if (typeof ticket !== "string" || !ticket) return null;
  prune();
  const ticketHash = createHash("sha256").update(ticket).digest("hex");
  const row = db()
    .prepare("SELECT id, email FROM one_time_codes WHERE purpose = ? AND code_hash = ?")
    .get(`${purpose}_ticket`, ticketHash) as { id: number; email: string } | undefined;
  if (!row) return null;
  db().prepare("DELETE FROM one_time_codes WHERE id = ?").run(row.id);
  return row.email;
}
