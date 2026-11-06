import type { NextRequest } from "next/server";
import { parseStyle } from "@/lib/terminal-style";
import { db } from "@/server/db.ts";
import { currentUser, fail, ok, readJson } from "@/server/http.ts";

/** Saves the terminal style for this account; every browser it logs in to uses it. */
export async function POST(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  const style = parseStyle(body.style);
  if (!style) return fail(400, "bad_value");
  db().prepare("UPDATE users SET terminal_style = ? WHERE id = ?").run(JSON.stringify(style), user.id);
  return ok({ style });
}
