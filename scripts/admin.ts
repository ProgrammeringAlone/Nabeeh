import { pool, transaction } from "../server/db.ts";
import { hashPasswordAsync } from "../server/auth.ts";
import { randomUUID } from "node:crypto";
const username = process.env.ADMIN_USERNAME,
  password = process.env.ADMIN_PASSWORD;
if (
  !username ||
  !/^[a-z0-9_]{3,30}$/.test(username)
)
  throw new Error(
    "Set ADMIN_USERNAME and ADMIN_PASSWORD (14+ characters) securely; do not commit them.",
  );
await transaction(async (db) => {
  const {
    rows: [existing],
  } = await db.query("SELECT id FROM users WHERE username=$1", [username]);
  if (existing) {
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [existing.id]);
    console.log("Existing account granted admin role; password unchanged.");
    return;
  }
  if (!password || password.length < 14) throw new Error("For a new administrator set ADMIN_PASSWORD securely (14+ characters), or register the account first.");
  const p = randomUUID();
  await db.query("INSERT INTO profiles(id,kind) VALUES($1,'account')", [p]);
  await db.query(
    "INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,$4,'admin')",
    [randomUUID(), p, username, await hashPasswordAsync(password)],
  );
});
console.log("Administrator provisioned.");
await pool.end();
