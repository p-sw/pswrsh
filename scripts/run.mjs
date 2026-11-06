// Runs the Next app and the SSH gateway together. Both bind to loopback only.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const mode = process.argv[2] === "start" ? "start" : "dev";
const port = process.env.PORT ?? "3000";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const children = [
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "gateway/server.mts"], { stdio: "inherit" }),
  spawn(process.execPath, [nextBin, mode, "-H", "127.0.0.1", "-p", port], { stdio: "inherit" }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}

for (const child of children) child.on("exit", (code) => stop(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
