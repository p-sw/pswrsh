// Seeds a finished setup, one account, and N login cookies into PSWRSH_DATA_DIR.
// Usage: PSWRSH_DATA_DIR=... node tests/node/seed-e2e.mts <devices> [userId] > cookies.json
import { db } from "../../src/server/db.ts";
import { createSession } from "../../src/server/sessions.ts";

const devices = Number(process.argv[2] ?? 2);
const userId = Number(process.argv[3] ?? 1);
db().prepare("UPDATE setup_state SET completed_at = ? WHERE id = 1").run(Date.now());
db().prepare("INSERT OR IGNORE INTO users (id, email, password_hash, is_admin, created_at, keep_alive_minutes) VALUES (?, ?, 'x', 1, 0, 5)").run(userId, 'e2e' + userId + '@t.test');
const tokens = Array.from({ length: devices }, () => createSession(userId).token);
process.stdout.write(JSON.stringify(tokens));
