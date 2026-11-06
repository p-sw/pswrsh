// Passkeys (WebAuthn). The RP ID is the host of the request's Origin, which must be one of
// the app's origins. WebAuthn does not allow IP addresses, so http://127.0.0.1 has no passkeys;
// use http://localhost locally.
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isIP } from "node:net";
import { storeChallenge, takeChallenge } from "./codes.ts";
import { db, now } from "./db.ts";
import { ALLOWED_ORIGINS } from "./origins.ts";

const RP_NAME = "pswrsh";

export type RelyingParty = { origin: string; rpID: string };

export function relyingParty(origin: string | null): RelyingParty | null {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  const rpID = new URL(origin).hostname;
  return isIP(rpID) ? null : { origin, rpID };
}

type PasskeyRow = { id: string; user_id: number; public_key: Uint8Array; counter: number; transports: string };

function userPasskeys(userId: number) {
  return db().prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").all(userId) as {
    id: string;
    transports: string;
  }[];
}

export async function registrationOptions(rp: RelyingParty, user: { id: number; email: string }) {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: user.email,
    userID: new TextEncoder().encode(`pswrsh-user-${user.id}`),
    attestationType: "none",
    excludeCredentials: userPasskeys(user.id).map((p) => ({
      id: p.id,
      transports: JSON.parse(p.transports) as AuthenticatorTransport[],
    })),
    // Discoverable credentials, so login can start without an email.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  storeChallenge("webauthn_reg", String(user.id), options.challenge);
  return options;
}

export async function registerPasskey(rp: RelyingParty, userId: number, name: string, response: RegistrationResponseJSON) {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: (challenge) => takeChallenge("webauthn_reg", String(userId), challenge),
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified) return false;
  const { credential } = verification.registrationInfo;
  db()
    .prepare(
      "INSERT INTO passkeys (id, user_id, name, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(credential.id, userId, name, credential.publicKey, credential.counter, JSON.stringify(credential.transports ?? []), now());
  return true;
}

export async function authenticationOptions(rp: RelyingParty) {
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  storeChallenge("webauthn_auth", rp.rpID, options.challenge);
  return options;
}

/** The user the passkey belongs to, or null. */
export async function authenticatePasskey(rp: RelyingParty, response: AuthenticationResponseJSON) {
  const row = db()
    .prepare("SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?")
    .get(response.id) as PasskeyRow | undefined;
  if (!row) return null;
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: (challenge) => takeChallenge("webauthn_auth", rp.rpID, challenge),
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: row.id,
      publicKey: new Uint8Array(row.public_key),
      counter: row.counter,
      transports: JSON.parse(row.transports) as AuthenticatorTransport[],
    },
    requireUserVerification: true,
  });
  if (!verification.verified) return null;
  db()
    .prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?")
    .run(verification.authenticationInfo.newCounter, now(), row.id);
  return row.user_id;
}

export function deletePasskey(userId: number, id: unknown) {
  if (typeof id !== "string") return false;
  return db().prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
