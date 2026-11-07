// Opens COUNT detached SSH connections through a running app; prints each outcome.
// Usage: APP=... COOKIES=... INDEX=... COUNT=17 SSH_PORT=2299 node tests/node/open-many.mts
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";

const APP = process.env.APP ?? "http://127.0.0.1:3310";
const TOKEN = JSON.parse(readFileSync(process.env.COOKIES!, "utf8"))[Number(process.env.INDEX ?? 0)];

function openOne(name: string) {
  return new Promise<string>((done) => {
    const ws = new WebSocket(APP.replace("http", "ws") + "/ws", { headers: { cookie: `pswrsh_session=${TOKEN}`, origin: APP } });
    ws.on("error", (e) => done("socket error " + e.message));
    ws.on("open", () =>
      ws.send(JSON.stringify({ t: "connect", host: "127.0.0.1", port: Number(process.env.SSH_PORT ?? 2299), username: "u", cols: 80, rows: 24, name })),
    );
    ws.on("message", (raw, binary) => {
      if (binary) return;
      const m = JSON.parse(String(raw));
      if (m.t === "hostkey") ws.send(JSON.stringify({ t: "trust", auth: { type: "password", password: "pw" } }));
      if (m.t === "ready") {
        ws.send(JSON.stringify({ t: "detach" }));
        setTimeout(() => done("ready " + m.name), 100);
      }
      if (m.t === "error") done(`error ${m.code}: ${m.message}`);
    });
  });
}

for (let i = 0; i < Number(process.env.COUNT ?? 1); i++) console.log(await openOne(process.env.NAME ?? "bulk"));
process.exit(0);
