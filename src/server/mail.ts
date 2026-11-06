// SMTP settings and sending. The SMTP password is stored in the database because the
// server must send mail; it is never logged, returned by an API, or shown again.
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { db, normalizeEmail, now } from "./db.ts";

export type SmtpSecurity = "tls" | "starttls" | "none";

export type SmtpSettings = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromAddress: string;
};

const SECURITY = new Set<SmtpSecurity>(["tls", "starttls", "none"]);

/** Validates SMTP input from a form. Returns null when something is missing or malformed. */
export function parseSmtp(input: unknown): SmtpSettings | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const host = typeof value.host === "string" ? value.host.trim() : "";
  const port = Number(value.port);
  const security = value.security as SmtpSecurity;
  const username = typeof value.username === "string" ? value.username.trim() : "";
  const password = typeof value.password === "string" ? value.password : "";
  const fromAddress = normalizeEmail(value.fromAddress);
  if (!host || host.length > 253 || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!SECURITY.has(security) || !fromAddress || username.length > 320 || password.length > 1024) return null;
  return { host, port, security, username, password, fromAddress };
}

/** Identifies one exact SMTP configuration, so setup can require that it was tested. */
export function smtpFingerprint(settings: SmtpSettings) {
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex");
}

export function saveSmtp(settings: SmtpSettings) {
  db()
    .prepare(
      `INSERT INTO smtp_settings (id, host, port, security, username, password, from_address, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET host = excluded.host, port = excluded.port, security = excluded.security,
         username = excluded.username, password = excluded.password, from_address = excluded.from_address,
         updated_at = excluded.updated_at`,
    )
    .run(settings.host, settings.port, settings.security, settings.username, settings.password, settings.fromAddress, now());
}

export function loadSmtp(): SmtpSettings | null {
  const row = db().prepare("SELECT * FROM smtp_settings WHERE id = 1").get() as
    | { host: string; port: number; security: SmtpSecurity; username: string; password: string; from_address: string }
    | undefined;
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    password: row.password,
    fromAddress: row.from_address,
  };
}

function transport(settings: SmtpSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // Logging would include the AUTH exchange.
    logger: false,
    debug: false,
  });
}

export type Mail = { to: string; subject: string; text: string };

/** Sends with the given settings. Errors carry no SMTP password. */
export async function sendMail(settings: SmtpSettings, mail: Mail) {
  const transporter = transport(settings);
  try {
    await transporter.sendMail({ from: settings.fromAddress, ...mail });
  } finally {
    transporter.close();
  }
}

/** Sends with the saved settings. */
export async function sendSystemMail(mail: Mail) {
  const settings = loadSmtp();
  if (!settings) throw new Error("SMTP is not configured");
  await sendMail(settings, mail);
}

/** A short, password-free reason for a failed send, for logs and the setup screen. */
export function describeMailError(error: unknown) {
  const value = error as { code?: string; responseCode?: number };
  const parts = [value?.code, value?.responseCode].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "UNKNOWN";
}
