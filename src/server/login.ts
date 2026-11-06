// Email and password login with a per-account and per-address limit of 5 failures a minute.
import { db, normalizeEmail, now } from "./db.ts";
import { burnPasswordCheck, verifyPassword } from "./password.ts";

const WINDOW_MS = 60 * 1000;
const MAX_FAILURES = 5;

export type SecondFactor = "email" | "totp";
export type LoginResult =
  | { userId: number; email: string; secondFactors: SecondFactor[] }
  | { error: "bad_credentials" | "too_many_attempts" };

function recentFailures(column: "email" | "ip", value: string) {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM login_failures WHERE ${column} = ? AND at > ?`)
    .get(value, now() - WINDOW_MS) as { n: number };
  return row.n;
}

function limited(email: string, ip: string) {
  db().prepare("DELETE FROM login_failures WHERE at < ?").run(now() - WINDOW_MS);
  return recentFailures("email", email) >= MAX_FAILURES || recentFailures("ip", ip) >= MAX_FAILURES;
}

export function recordFailure(email: string, ip: string) {
  db().prepare("INSERT INTO login_failures (email, ip, at) VALUES (?, ?, ?)").run(email, ip, now());
}

/** Second factors the account has turned on. */
export function secondFactorsOf(userId: number): SecondFactor[] {
  const row = db().prepare("SELECT email_otp, totp_secret FROM users WHERE id = ?").get(userId) as
    | { email_otp: number; totp_secret: string | null }
    | undefined;
  if (!row) return [];
  const factors: SecondFactor[] = [];
  if (row.totp_secret) factors.push("totp");
  if (row.email_otp === 1) factors.push("email");
  return factors;
}

export async function login(rawEmail: unknown, password: unknown, ip: string): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail) ?? (typeof rawEmail === "string" ? rawEmail.trim().toLowerCase().slice(0, 254) : "");
  if (limited(email, ip)) return { error: "too_many_attempts" };
  const user = db().prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as
    | { id: number; password_hash: string }
    | undefined;
  const given = typeof password === "string" ? password : "";
  const valid = user ? await verifyPassword(given, user.password_hash) : (await burnPasswordCheck(given), false);
  if (!user || !valid) {
    recordFailure(email, ip);
    return { error: "bad_credentials" };
  }
  return { userId: user.id, email, secondFactors: secondFactorsOf(user.id) };
}

/** Re-checks the password of a logged-in user, under the same failure limit as login. */
export async function confirmPassword(
  userId: number,
  password: unknown,
  ip: string,
): Promise<"ok" | "bad_password" | "too_many_attempts"> {
  const user = db().prepare("SELECT email, password_hash FROM users WHERE id = ?").get(userId) as
    | { email: string; password_hash: string }
    | undefined;
  if (!user) return "bad_password";
  if (limited(user.email, ip)) return "too_many_attempts";
  if (typeof password === "string" && (await verifyPassword(password, user.password_hash))) return "ok";
  recordFailure(user.email, ip);
  return "bad_password";
}
