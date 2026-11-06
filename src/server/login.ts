// Email and password login with a per-account and per-address limit of 5 failures a minute.
import { db, normalizeEmail, now } from "./db.ts";
import { burnPasswordCheck, verifyPassword } from "./password.ts";

const WINDOW_MS = 60 * 1000;
const MAX_FAILURES = 5;

export type LoginResult = { userId: number } | { error: "bad_credentials" | "too_many_attempts" };

function recentFailures(column: "email" | "ip", value: string) {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM login_failures WHERE ${column} = ? AND at > ?`)
    .get(value, now() - WINDOW_MS) as { n: number };
  return row.n;
}

export async function login(rawEmail: unknown, password: unknown, ip: string): Promise<LoginResult> {
  db().prepare("DELETE FROM login_failures WHERE at < ?").run(now() - WINDOW_MS);
  const email = normalizeEmail(rawEmail) ?? (typeof rawEmail === "string" ? rawEmail.trim().toLowerCase().slice(0, 254) : "");
  if (recentFailures("email", email) >= MAX_FAILURES || recentFailures("ip", ip) >= MAX_FAILURES) {
    return { error: "too_many_attempts" };
  }
  const user = db().prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as
    | { id: number; password_hash: string }
    | undefined;
  const given = typeof password === "string" ? password : "";
  const valid = user ? await verifyPassword(given, user.password_hash) : (await burnPasswordCheck(given), false);
  if (!user || !valid) {
    db().prepare("INSERT INTO login_failures (email, ip, at) VALUES (?, ?, ?)").run(email, ip, now());
    return { error: "bad_credentials" };
  }
  return { userId: user.id };
}
