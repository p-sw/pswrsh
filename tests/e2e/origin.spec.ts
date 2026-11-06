// 외부 Origin의 WebSocket은 거절된다. 게이트웨이 직접과 앱의 /ws 프록시 양쪽.
import { expect, test } from "@playwright/test";
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
];

/** Sends the header a browser on that page would send. */
function attempt(url: string, origin: string | undefined) {
  return new Promise<{ opened: boolean; status?: number }>((resolve) => {
    const socket = new WebSocket(url, { ...(origin === undefined ? {} : { origin }), handshakeTimeout: 10_000 });
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
      test(`Origin ${origin} 은 열리지 않는다`, async () => {
        expect((await attempt(url, origin)).opened).toBe(false);
      });
    }

    test("Origin 헤더가 없으면 열리지 않는다", async () => {
      expect((await attempt(url, undefined)).opened).toBe(false);
    });

    for (const origin of [`http://127.0.0.1:${APP_PORT}`, `http://localhost:${APP_PORT}`]) {
      test(`앱 Origin ${origin} 은 열린다`, async () => {
        expect((await attempt(url, origin)).opened).toBe(true);
      });
    }
  });
}
