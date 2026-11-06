import type { NextRequest } from "next/server";
import { currentUser, fail, ok, readJson } from "@/server/http.ts";
import { isSignupEnabled, setSignupEnabled } from "@/server/setup.ts";

/** Admin switch for signup. The settings page that will use it comes later. */
export async function GET(request: NextRequest) {
  if (!currentUser(request)?.isAdmin) return fail(403, "admin_only");
  return ok({ enabled: isSignupEnabled() });
}

export async function POST(request: NextRequest) {
  if (!currentUser(request)?.isAdmin) return fail(403, "admin_only");
  const body = await readJson(request);
  if (typeof body.enabled !== "boolean") return fail(400, "bad_value");
  setSignupEnabled(body.enabled);
  return ok({ enabled: body.enabled });
}
