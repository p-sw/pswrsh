import type { NextRequest } from "next/server";
import { db, normalizeEmail, now } from "@/server/db.ts";
import { fail, ok, readJson, startSession } from "@/server/http.ts";
import { parseSmtp, saveSmtp, smtpFingerprint } from "@/server/mail.ts";
import { hashPassword, isAcceptablePassword } from "@/server/password.ts";
import { checkSetupToken, isSetupComplete, markSetupComplete, smtpWasChecked } from "@/server/setup.ts";

export async function POST(request: NextRequest) {
  if (isSetupComplete()) return fail(404, "not_available");
  const body = await readJson(request);
  if (!checkSetupToken(body.token)) return fail(403, "bad_token");
  const email = normalizeEmail(body.email);
  const smtp = parseSmtp(body.smtp);
  if (!email) return fail(400, "bad_email");
  if (!isAcceptablePassword(body.password)) return fail(400, "bad_password");
  if (!smtp) return fail(400, "bad_smtp");
  if (!smtpWasChecked(smtpFingerprint(smtp))) return fail(409, "smtp_not_tested");

  const passwordHash = await hashPassword(body.password);
  const database = db();
  let userId: number;
  database.exec("BEGIN IMMEDIATE");
  try {
    if (isSetupComplete()) {
      database.exec("ROLLBACK");
      return fail(404, "not_available");
    }
    const result = database
      .prepare("INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)")
      .run(email, passwordHash, now());
    userId = Number(result.lastInsertRowid);
    saveSmtp(smtp);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  markSetupComplete();
  return startSession(request, ok(), userId);
}
