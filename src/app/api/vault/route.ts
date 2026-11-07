import type { NextRequest } from "next/server";
import { currentUser, fail, ok, readJson } from "@/server/http.ts";
import { deleteVaultRow, parseSealedVault, readVaultRow, writeVaultRow } from "@/server/vault.ts";

/** The account's sealed vault. Every browser this account logs in to reads the same one. */
export async function GET(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const row = readVaultRow(user.id);
  // Tabs poll this to notice saves from other devices; they only need the revision.
  if (request.nextUrl.searchParams.has("revision")) return ok({ revision: row?.revision ?? 0 });
  return ok({ vault: row?.vault ?? null, revision: row?.revision ?? 0 });
}

/** Saves the vault if `revision` is the one the browser read; 409 when another browser saved first. */
export async function PUT(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  const body = await readJson(request);
  const vault = parseSealedVault(body.vault);
  const expected = Number(body.revision);
  if (!vault || !Number.isInteger(expected) || expected < 0) return fail(400, "bad_value");
  const revision = writeVaultRow(user.id, vault, expected);
  if (revision === null) return fail(409, "stale_revision");
  return ok({ revision });
}

export async function DELETE(request: NextRequest) {
  const user = currentUser(request);
  if (!user) return fail(401, "login_required");
  deleteVaultRow(user.id);
  return ok();
}
