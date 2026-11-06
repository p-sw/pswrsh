import type { NextRequest } from "next/server";
import { currentUser, fail, ok } from "@/server/http.ts";
import { settingsFor } from "@/server/settings.ts";

export async function GET(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  return ok({ settings: settingsFor(user) });
}
