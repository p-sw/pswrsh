// Origins this app is served from. The gateway accepts WebSockets only from these,
// and passkeys are bound to the host of one of them.
export const APP_PORT = process.env.PORT ?? "3000";
// The temporary Cloudflare Tunnel serves this app at ssh.psw.kr.
export const PUBLIC_ORIGIN = "https://ssh.psw.kr";
export const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${APP_PORT}`, `http://localhost:${APP_PORT}`, PUBLIC_ORIGIN]);
