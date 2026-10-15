import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export async function hashPasswordAsync(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function checkPasswordAsync(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = (await derive(password, salt, 64)) as Buffer;
  return (
    key?.length === 128 && timingSafeEqual(actual, Buffer.from(key, "hex"))
  );
}
import type { Request, Response, NextFunction } from "express";
import { pool, transaction, AppError } from "./db.ts";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function checkPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  return (
    key?.length === 128 && timingSafeEqual(actual, Buffer.from(key, "hex"))
  );
}
export interface Identity {
  profileId: string;
  userId: string | null;
  username: string | null;
  role: string;
}
declare global {
  namespace Express {
    interface Request {
      identity: Identity;
    }
  }
}
export async function setSession(res: Response, profileId: string) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '180 days')",
    [tokenHash(token), profileId],
  );
  res.cookie("nabeeh_session", token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: 180 * 86400000,
  });
}
export const cookieToken = (req: Request) =>
  req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("nabeeh_session="))
    ?.slice(15);
export async function identity(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = cookieToken(req);
    const { rows } = token
      ? await pool.query(
          `SELECT s.profile_id AS "profileId",u.id AS "userId",u.username,u.role FROM sessions s LEFT JOIN users u ON u.profile_id=s.profile_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
          [tokenHash(token)],
        )
      : { rows: [] };
    if (rows.length) {
      req.identity = { ...rows[0], role: rows[0].role || "guest" };
      const renewed = await pool.query(
        "UPDATE sessions SET expires_at=now()+interval '180 days' WHERE token_hash=$1 AND expires_at < now()+interval '179 days' RETURNING profile_id",
        [tokenHash(token!)],
      );
      // Ordinary reads must not reissue an old token after an overlapping login
      // rotates it. Renew the browser credential only when its expiry changed.
      if (renewed.rowCount) res.cookie("nabeeh_session", token, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === "true",
        sameSite: "lax",
        path: "/",
        maxAge: 180 * 86400000,
      });
    } else {
      const id = randomUUID();
      await pool.query("INSERT INTO profiles(id,kind) VALUES($1,'guest')", [
        id,
      ]);
      await setSession(res, id);
      req.identity = {
        profileId: id,
        userId: null,
        username: null,
        role: "guest",
      };
    }
    next();
  } catch (error) {
    next(error);
  }
}
export async function mergeProfiles(guest: string, target: string) {
  if (guest === target) return;
  await transaction(async (db) => {
    await db.query(
      "SELECT id FROM profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[guest, target]],
    );
    const kind = await db.query("SELECT kind FROM profiles WHERE id=$1", [
      guest,
    ]);
    if (kind.rows[0]?.kind !== "guest") return; // Never merge one account into another account.
    // Close guest boards to release reservations; shown questions still merge permanently.
    const guestGames = await db.query(
      "UPDATE games SET status='abandoned',current_instance=null WHERE host_id=$1 AND status='active' RETURNING id",
      [guest],
    );
    if (guestGames.rowCount)
      await db.query("DELETE FROM reservations WHERE game_id=ANY($1::uuid[])", [
        guestGames.rows.map((x) => x.id),
      ]);
    await db.query(
      `INSERT INTO exposures(profile_id,question_id,category_id,game_id,instance_id,shown_at,answer_revealed,outcome,completed) SELECT $2,question_id,category_id,game_id,instance_id,shown_at,answer_revealed,outcome,completed FROM exposures WHERE profile_id=$1 ON CONFLICT(profile_id,question_id) DO UPDATE SET shown_at=LEAST(exposures.shown_at,EXCLUDED.shown_at),answer_revealed=exposures.answer_revealed OR EXCLUDED.answer_revealed,completed=exposures.completed OR EXCLUDED.completed`,
      [guest, target],
    );
    await db.query(
      "INSERT INTO favorites(profile_id,category_id) SELECT $2,category_id FROM favorites WHERE profile_id=$1 ON CONFLICT DO NOTHING",
      [guest, target],
    );
    // A preexisting unopened account reservation may now be exposed. Abandon that board safely.
    const collisions = await db.query(
      "SELECT DISTINCT r.game_id FROM reservations r JOIN exposures e ON e.profile_id=r.profile_id AND e.question_id=r.question_id JOIN game_questions i ON i.game_id=r.game_id AND i.question_id=r.question_id WHERE r.profile_id=$1 AND i.status='available'",
      [target],
    );
    if (collisions.rowCount) {
      const ids = collisions.rows.map((x) => x.game_id);
      await db.query(
        "UPDATE games SET status='abandoned',current_instance=null WHERE id=ANY($1::uuid[])",
        [ids],
      );
      await db.query("DELETE FROM reservations WHERE game_id=ANY($1::uuid[])", [
        ids,
      ]);
    }
    await db.query("UPDATE games SET host_id=$2 WHERE host_id=$1", [
      guest,
      target,
    ]);
    // Guest history remains linked, without inventing ranked team assignments.
    await db.query(
      "INSERT INTO game_participants(game_id,profile_id,team_index) SELECT game_id,$2,NULL FROM game_participants WHERE profile_id=$1 ON CONFLICT(game_id,profile_id) DO NOTHING",
      [guest, target],
    );
    await db.query("DELETE FROM game_participants WHERE profile_id=$1", [
      guest,
    ]);
    await db.query("DELETE FROM sessions WHERE profile_id=$1", [guest]);
  });
}
export function requireEditor(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!["editor", "admin"].includes(req.identity.role))
    return next(new AppError(403, "FORBIDDEN", "هذه الصفحة للمحرّرين فقط."));
  next();
}
export async function updateRole(
  actor: string,
  target: string,
  role: "player" | "editor" | "admin",
  reason: string,
) {
  await transaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('nabeeh-role-management'))",
    );
    const {
      rows: [operator],
    } = await db.query("SELECT role FROM users WHERE id=$1 FOR UPDATE", [
      actor,
    ]);
    if (operator?.role !== "admin")
      throw new AppError(
        403,
        "ADMIN_REQUIRED",
        "تعديل صلاحيات المستخدمين متاح للمدير فقط.",
      );
    const {
      rows: [user],
    } = await db.query("SELECT role FROM users WHERE id=$1 FOR UPDATE", [
      target,
    ]);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "الحساب غير موجود.");
    if (
      user.role === "admin" &&
      role !== "admin" &&
      (
        await db.query(
          "SELECT count(*)::int AS count FROM users WHERE role='admin'",
        )
      ).rows[0].count <= 1
    )
      throw new AppError(
        409,
        "LAST_ADMIN",
        "أضف مديرًا آخر قبل تغيير صلاحية آخر مدير.",
      );
    await db.query("UPDATE users SET role=$2 WHERE id=$1", [target, role]);
    await db.query(
      "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'change-role',$2,$3)",
      [actor, target, { previous: user.role, role, reason }],
    );
  });
}
