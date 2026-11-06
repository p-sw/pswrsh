import type { NextRequest } from "next/server";
import { db } from "@/server/db.ts";
import { currentUser, fail, ok, readJson } from "@/server/http.ts";
import { KEEP_ALIVE_CHOICES } from "@/server/settings.ts";

/** Stores how long SSH sessions outlive the page. The gateway uses it from step D on. */
export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  const minutes = Number(body.minutes);
  if (!(KEEP_ALIVE_CHOICES as readonly number[]).includes(minutes)) return fail(400, "bad_value");
  db().prepare("UPDATE users SET keep_alive_minutes = ? WHERE id = ?").run(minutes, user.id);
  return ok({ minutes });
}
