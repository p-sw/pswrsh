import type { NextRequest } from "next/server";
import { consumeTicket } from "@/server/codes.ts";
import { db } from "@/server/db.ts";
import { fail, ok, readJson } from "@/server/http.ts";
import { hashPassword, isAcceptablePassword } from "@/server/password.ts";
import { deleteUserSessions } from "@/server/sessions.ts";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  if (!isAcceptablePassword(body.password)) return fail(400, "bad_password");
  const email = consumeTicket("reset", body.ticket);
  if (!email) return fail(400, "ticket_invalid");
  const user = db().prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
  if (!user) return fail(400, "ticket_invalid");
  db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(body.password), user.id);
  // A reset logs out every browser that used the old password.
  deleteUserSessions(user.id);
  return ok();
}
