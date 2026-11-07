// Seeds an account with a real password so a browser can log in through /login.
// Usage: PSWRSH_DATA_DIR=... node tests/node/seed-login.mts <userId> <email> <password>
import { db } from "../../src/server/db.ts";
import { hashPassword } from "../../src/server/password.ts";

const [id, email, password] = process.argv.slice(2);
db().prepare("UPDATE setup_state SET completed_at = ? WHERE id = 1").run(Date.now());
db()
  .prepare("INSERT OR REPLACE INTO users (id, email, password_hash, is_admin, created_at, keep_alive_minutes) VALUES (?, ?, ?, 0, 0, 5)")
  .run(Number(id), email, await hashPassword(password));
console.log("ok");
