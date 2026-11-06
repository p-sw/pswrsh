// Per-account settings read by the settings page.
import { db } from "./db.ts";
import { secondFactorsOf } from "./login.ts";
import { isSignupEnabled } from "./setup.ts";
import type { SessionUser } from "./sessions.ts";

export const KEEP_ALIVE_CHOICES = [5, 30, 60, 180] as const;

export function settingsFor(user: SessionUser) {
  const row = db().prepare("SELECT keep_alive_minutes, terminal_style FROM users WHERE id = ?").get(user.id) as {
    keep_alive_minutes: number;
    terminal_style: string | null;
  };
  const passkeys = db()
    .prepare("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at")
    .all(user.id) as { id: string; name: string; created_at: number; last_used_at: number | null }[];
  const factors = secondFactorsOf(user.id);
  return {
    email: user.email,
    isAdmin: user.isAdmin,
    keepAliveMinutes: row.keep_alive_minutes,
    emailOtp: factors.includes("email"),
    totp: factors.includes("totp"),
    passkeys: passkeys.map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, lastUsedAt: p.last_used_at })),
    terminalStyle: row.terminal_style ? (JSON.parse(row.terminal_style) as unknown) : null,
    signupEnabled: user.isAdmin ? isSignupEnabled() : undefined,
  };
}

export type AccountSettings = ReturnType<typeof settingsFor>;
