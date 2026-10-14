import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool, transaction, AppError } from "./db.ts";
import { hashPasswordAsync, checkPasswordAsync, tokenHash } from "./auth.ts";
function canonicalKey(value: string) { return value.trim().replace(/-/g, "").toLowerCase(); }
export async function issueRecoveryKey(db: pg.PoolClient, userId: string) {
  const token = randomBytes(24).toString("hex");
  await db.query("INSERT INTO recovery_keys(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 year') ON CONFLICT(user_id) DO UPDATE SET token_hash=$2,expires_at=now()+interval '1 year',created_at=now()", [userId, tokenHash(token)]);
  return token.match(/.{1,6}/g)!.join("-");
}
export async function rotateRecoveryKey(userId: string, password: string) {
  const { rows: [user] } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [userId]);
  if (!user || !await checkPasswordAsync(password, user.password_hash))
    throw new AppError(401, "PASSWORD_REQUIRED", "أدخل كلمة المرور الصحيحة.");
  return transaction(async db => {
    const { rows: [locked] } = await db.query("SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (locked.password_hash !== user.password_hash) throw new AppError(409, "AUTH_CHANGED", "أعد المحاولة بعد تسجيل الدخول.");
    return issueRecoveryKey(db, userId);
  });
}
export async function recoverAccount(username: string, key: string, password: string) {
  const passwordHash = await hashPasswordAsync(password);
  return transaction(async db => {
    const { rows: [user] } = await db.query("SELECT u.id,u.profile_id FROM users u JOIN recovery_keys r ON r.user_id=u.id WHERE u.username=$1 AND r.token_hash=$2 AND r.expires_at>now() FOR UPDATE OF u,r", [username, tokenHash(canonicalKey(key))]);
    if (!user) throw new AppError(401, "RECOVERY_INVALID", "اسم المستخدم أو مفتاح الاستعادة غير صالح أو منتهي.");
    await db.query("UPDATE users SET password_hash=$2 WHERE id=$1", [user.id, passwordHash]);
    await db.query("DELETE FROM sessions WHERE profile_id=$1", [user.profile_id]);
    const recoveryKey = await issueRecoveryKey(db, user.id);
    await db.query("INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'recover-account',$2,'{}')", [user.id,user.id]);
    return recoveryKey;
  });
}
