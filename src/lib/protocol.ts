// Wire protocol between the browser and the SSH gateway.
// Binary frames carry terminal bytes; text frames carry these JSON messages.

export type AuthPayload =
  | { type: "password"; password: string }
  | { type: "key"; privateKey: string; passphrase?: string }
  | { type: "interactive" };

export type ClientMessage =
  | { t: "connect"; host: string; port: number; username: string; cols: number; rows: number }
  // Credentials leave the browser only after the host key has been accepted.
  | { t: "trust"; auth: AuthPayload }
  | { t: "kbd"; answers: string[] }
  | { t: "resize"; cols: number; rows: number }
  | { t: "ack"; bytes: number };

export type KbdPrompt = { prompt: string; echo: boolean };

export type ErrorCode = "auth" | "key" | "network" | "timeout" | "protocol";

export type ServerMessage =
  | { t: "hostkey"; algorithm: string; fingerprint: string }
  | { t: "kbd"; name: string; instructions: string; prompts: KbdPrompt[] }
  | { t: "ready" }
  | { t: "error"; code: ErrorCode; message: string }
  | { t: "closed" };
