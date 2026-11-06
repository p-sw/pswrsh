import type { NextRequest } from "next/server";
import { consumeTicket } from "@/server/codes.ts";
import { db, now } from "@/server/db.ts";
import { fail, ok, readJson, startSession } from "@/server/http.ts";
import { hashPassword, isAcceptablePassword } from "@/server/password.ts";
import { isSignupEnabled } from "@/server/setup.ts";

export async function POST(request: NextRequest) {
  if (!isSignupEnabled()) return fail(403, "signup_disabled");
  const body = await readJson(request);
  if (!isAcceptablePassword(body.password)) return fail(400, "bad_password");
  const email = consumeTicket("signup", body.ticket);
  if (!email) return fail(400, "ticket_invalid");
  const passwordHash = await hashPassword(body.password);
  try {
    const result = db()
      .prepare("INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)")
      .run(email, passwordHash, now());
    return startSession(request, ok(), Number(result.lastInsertRowid));
  } catch {
    return fail(409, "email_taken");
  }
}
