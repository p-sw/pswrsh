// 외부 Origin의 WebSocket은 거절된다. 게이트웨이 직접과 앱의 /ws 프록시 양쪽.
// 게이트웨이는 로그인한 계정만 받는다. 그래서 모든 시도에 로그인 쿠키를 실어,
// 거절이 Origin 때문인지(로그인이 없어서가 아니라) 본다.
import { type BrowserContext, expect, test } from "./support/fixtures";
import { WebSocket } from "ws";
import { APP_PORT, GATEWAY_PORT } from "./support/ports";

const ENDPOINTS = [
  { label: "게이트웨이 직접", url: `ws://127.0.0.1:${GATEWAY_PORT}/ws` },
  { label: "앱 /ws 프록시", url: `ws://127.0.0.1:${APP_PORT}/ws` },
];

const EXTERNAL_ORIGINS = [
  "https://evil.example",
  `http://evil.example:${APP_PORT}`,
  `http://127.0.0.1.evil.example:${APP_PORT}`,
  "http://localhost.evil.example",
  "http://evil.example/127.0.0.1",
  "null",
  // 같은 머신의 다른 웹앱도 외부다.
  "http://127.0.0.1:9999",
  "http://localhost:9999",
  "http://[::1]:9999",
  `http://[::1]:${APP_PORT}`,
  `https://127.0.0.1:${APP_PORT}`,
  `https://localhost:${APP_PORT}`,
  `http://127.0.0.1:${GATEWAY_PORT}`,
  // 앱 포트가 아닌 3000도 거절이어야 한다(테스트가 다른 포트로 돌 때만 의미가 있다).
  ...(APP_PORT === 3000 ? [] : ["http://127.0.0.1:3000", "http://localhost:3000"]),
  // 임시 공개 주소와 비슷한 주소.
  "http://ssh.psw.kr",
  "https://ssh.psw.kr:443",
  "https://ssh.psw.kr.evil.example",
  "https://evil.ssh.psw.kr",
  "https://psw.kr",
];

/** The logged-in context's cookies, as a browser on the app's page would send them. */
async function cookieHeader(context: BrowserContext) {
  return (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Sends the headers a browser on that page would send. */
function attempt(url: string, origin: string | undefined, cookie: string) {
  return new Promise<{ opened: boolean; status?: number }>((resolve) => {
    const socket = new WebSocket(url, {
      ...(origin === undefined ? {} : { origin }),
      headers: { cookie },
      handshakeTimeout: 10_000,
    });
    socket.once("open", () => {
      socket.terminate();
      resolve({ opened: true });
    });
    socket.once("unexpected-response", (_request, response) => {
      socket.terminate();
      resolve({ opened: false, status: response.statusCode });
    });
    socket.once("error", () => resolve({ opened: false }));
  });
}

for (const { label, url } of ENDPOINTS) {
  test.describe(label, () => {
    for (const origin of EXTERNAL_ORIGINS) {
      test(`Origin ${origin} 은 열리지 않는다`, async ({ context }) => {
        expect((await attempt(url, origin, await cookieHeader(context))).opened).toBe(false);
      });
    }

    test("Origin 헤더가 없으면 열리지 않는다", async ({ context }) => {
      expect((await attempt(url, undefined, await cookieHeader(context))).opened).toBe(false);
    });

    // https://ssh.psw.kr: 주인이 정한 임시 Cloudflare Tunnel 주소다.
    for (const origin of [`http://127.0.0.1:${APP_PORT}`, `http://localhost:${APP_PORT}`, "https://ssh.psw.kr"]) {
      test(`앱 Origin ${origin} 은 열린다`, async ({ context }) => {
        expect((await attempt(url, origin, await cookieHeader(context))).opened).toBe(true);
      });
    }

    test("앱 Origin이어도 로그인 쿠키가 없으면 열리지 않는다", async () => {
      expect((await attempt(url, `http://127.0.0.1:${APP_PORT}`, "")).opened).toBe(false);
    });
  });
}
