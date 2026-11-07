// Keeps a throwaway SSH server up for manual/browser checks. Accepts any login.
// Usage: node tests/node/dummy-ssh-serve.mts <port> [seconds]
import { DummySsh } from "../e2e/support/dummy-ssh.ts";

const ssh = await new DummySsh().start(Number(process.argv[2] ?? 2299));
console.log(`dummy ssh on 127.0.0.1:${ssh.port}`);
setTimeout(() => void ssh.stop().then(() => process.exit(0)), Number(process.argv[3] ?? 1800) * 1000);
