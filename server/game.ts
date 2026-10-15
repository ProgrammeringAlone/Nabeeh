import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { pool, transaction, AppError } from "./db.ts";
import { tokenHash } from "./auth.ts";
import { wakeWorker } from "./worker.ts";
import { allocateBoard } from "./selection.ts";
import { normalizeLeaderboardTeamName } from "./leaderboard.ts";
export const setupSchema = z
  .object({
    categoryIds: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(6)
      .refine((x) => new Set(x).size === x.length),
    mode: z.enum(["classic", "rapid"]).default("classic"),
    teamNames: z.tuple([
      z.string().trim().min(1).max(40),
      z.string().trim().min(1).max(40),
    ]),
    timer: z.number().int().min(15).max(180).default(60),
    questionsPerCategory: z.union([z.literal(3), z.literal(6)]).default(3),
    difficulty: z
      .enum(["mixed", "easy", "medium", "hard", "expert"])
      .default("mixed"),
    region: z.enum(["all", "sa", "kw", "ae", "bh", "qa", "om"]).default("all"),
    stealing: z.boolean().default(true),
    negativeScores: z.boolean().default(false),
    lifelines: z
      .array(z.enum(["hint", "double", "extra-time"]))
      .max(3)
      .default(["hint", "double"]),
    players: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(40),
          team: z.union([z.literal(0), z.literal(1)]),
        }),
      )
      .max(20)
      .default([]),
    participantTokens: z.array(z.string().min(20).max(100)).max(12).default([]),
    hostTeam: z.union([z.literal(0), z.literal(1)]).optional(),
    participantTeams: z
      .array(z.union([z.literal(0), z.literal(1)]))
      .max(12)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      normalizeLeaderboardTeamName(v.teamNames[0]) ===
      normalizeLeaderboardTeamName(v.teamNames[1])
    )
      ctx.addIssue({
        code: "custom",
        path: ["teamNames"],
        message: "اختر اسمين مختلفين للفريقين.",
      });
    if (new Set(v.participantTokens).size !== v.participantTokens.length)
      ctx.addIssue({
        code: "custom",
        path: ["participantTokens"],
        message: "أضف رمز كل مشارك مرة واحدة.",
      });
    if (
      v.participantTeams &&
      v.participantTeams.length !== v.participantTokens.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["participantTeams"],
        message: "حدّد فريقًا لكل رمز مشاركة.",
      });
  });
export async function createGame(host: string, input: unknown) {
  const setup = setupSchema.parse(input),
    id = randomUUID();
  return transaction(async (db) => {
    const participants = [host];
    const assignments = new Map<string, number | null>([
      [host, setup.hostTeam ?? null],
    ]);
    for (const { token, index } of setup.participantTokens
      .map((token, index) => ({ token, index }))
      .sort((a, b) => (a.token < b.token ? -1 : 1))) {
      const {
        rows: [row],
      } = await db.query(
        "SELECT profile_id FROM participant_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
        [tokenHash(token)],
      );
      if (!row)
        throw new AppError(
          400,
          "PARTICIPANT_TOKEN",
          "رمز المشارك منتهي أو غير صالح.",
        );
      participants.push(row.profile_id);
      const team = setup.participantTeams?.[index] ?? null;
      if (
        assignments.has(row.profile_id) &&
        team !== null &&
        assignments.get(row.profile_id) !== null &&
        assignments.get(row.profile_id) !== team
      )
        throw new AppError(
          400,
          "PARTICIPANT_TEAM",
          "لا يمكن ربط الحساب نفسه بفريقين في اللعبة الواحدة.",
        );
      assignments.set(row.profile_id, assignments.get(row.profile_id) ?? team);
      await db.query(
        "UPDATE participant_tokens SET consumed_at=now() WHERE token_hash=$1",
        [tokenHash(token)],
      );
    }
    const profiles = [...new Set(participants)].sort();
    await db.query(
      "SELECT id FROM profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [profiles],
    );
    await db.query(
      "INSERT INTO games(id,host_id,mode,timer,stealing,negative_scores,lifelines) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        host,
        setup.mode,
        setup.mode === "rapid" ? Math.min(30, setup.timer) : setup.timer,
        setup.stealing,
        setup.negativeScores,
        [...new Set(setup.lifelines)],
      ],
    );
    for (let t = 0; t < 2; t++)
      await db.query(
        "INSERT INTO teams(game_id,team_index,name) VALUES($1,$2,$3)",
        [id, t, setup.teamNames[t]],
      );
    for (const p of setup.players)
      await db.query(
        "INSERT INTO players(id,game_id,team_index,name) VALUES($1,$2,$3,$4)",
        [randomUUID(), id, p.team, p.name],
      );
    const registered = new Set(
      (
        await db.query(
          "SELECT profile_id FROM users WHERE profile_id=ANY($1::uuid[])",
          [profiles],
        )
      ).rows.map((u) => u.profile_id),
    );
    for (const p of profiles)
      await db.query(
        "INSERT INTO game_participants(game_id,profile_id,team_index) VALUES($1,$2,$3)",
        [id, p, registered.has(p) ? (assignments.get(p) ?? null) : null],
      );
    let position = 0;
    if (
      (
        await db.query("SELECT id FROM categories WHERE id=ANY($1)", [
          setup.categoryIds,
        ])
      ).rowCount !== setup.categoryIds.length
    )
      throw new AppError(400, "CATEGORY", "الفئة غير موجودة.");
    const selected = await allocateBoard(db, profiles, setup);
    for (const [index, category] of setup.categoryIds.entries()) {
      if (
        !(await db.query("SELECT 1 FROM categories WHERE id=$1", [category]))
          .rowCount
      )
        throw new AppError(400, "CATEGORY", "الفئة غير موجودة.");
      await db.query("INSERT INTO game_categories VALUES($1,$2,$3)", [
        id,
        category,
        index,
      ]);
      for (let n = 0; n < setup.questionsPerCategory; n++) {
        const difficulty =
          setup.difficulty === "mixed"
            ? ["easy", "medium", "hard"][n % 3]
            : setup.difficulty;
        const q = { id: selected[position].questionId };
        await db.query(
          "INSERT INTO game_questions(id,game_id,question_id,category_id,value,position) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            id,
            q.id,
            category,
            [200, 400, 600, 800][
              ["easy", "medium", "hard", "expert"].indexOf(difficulty)
            ],
            position++,
          ],
        );
        for (const p of profiles)
          await db.query("INSERT INTO reservations VALUES($1,$2,$3)", [
            p,
            q.id,
            id,
          ]);
      }
    }
    return { id };
  }).catch(async (error) => {
    if (error instanceof AppError && error.code === "FRESH_POOL_EXHAUSTED") {
      for (const cat of setup.categoryIds) {
        await pool.query(
          "INSERT INTO replenishment_requests(category_id,difficulty,region) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM categories WHERE id=$1) ON CONFLICT(category_id,difficulty,region) DO UPDATE SET requested_at=now(),resolved_at=null",
          [cat, setup.difficulty, setup.region],
        );
        await pool.query(
          "INSERT INTO generation_jobs(id,category_id,kind,count) SELECT $1,$2,'arithmetic',6 WHERE $2='logic' ON CONFLICT DO NOTHING",
          [randomUUID(), cat],
        );
      }
    }
    if (error instanceof AppError && error.code === "FRESH_POOL_EXHAUSTED")
      wakeWorker();
    throw error;
  });
}
async function lockGame(db: pg.PoolClient, id: string, host: string) {
  const participants = await db.query(
    "SELECT gp.profile_id FROM game_participants gp JOIN games g ON g.id=gp.game_id WHERE g.id=$1 AND g.host_id=$2 ORDER BY gp.profile_id",
    [id, host],
  );
  if (participants.rowCount)
    await db.query(
      "SELECT id FROM profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [participants.rows.map((x) => x.profile_id)],
    );
  const {
    rows: [game],
  } = await db.query(
    "SELECT * FROM games WHERE id=$1 AND host_id=$2 FOR UPDATE",
    [id, host],
  );
  if (!game) throw new AppError(404, "GAME_NOT_FOUND", "اللعبة غير موجودة.");
  if (game.status !== "active")
    throw new AppError(409, "GAME_CLOSED", "انتهت هذه اللعبة.");
  return game;
}
export async function gameState(id: string, host: string) {
  const {
    rows: [game],
  } = await pool.query("SELECT * FROM games WHERE id=$1 AND host_id=$2", [
    id,
    host,
  ]);
  if (!game) throw new AppError(404, "GAME_NOT_FOUND", "اللعبة غير موجودة.");
  const [teams, categories, tiles, uses, players] = await Promise.all([
    pool.query(
      "SELECT team_index,name,score FROM teams WHERE game_id=$1 ORDER BY team_index",
      [id],
    ),
    pool.query(
      "SELECT c.*,gc.position FROM game_categories gc JOIN categories c ON c.id=gc.category_id WHERE gc.game_id=$1 ORDER BY gc.position",
      [id],
    ),
    pool.query(
      "SELECT id,category_id,value,position,status,outcome FROM game_questions WHERE game_id=$1 ORDER BY position",
      [id],
    ),
    pool.query("SELECT team_index,kind FROM lifeline_usage WHERE game_id=$1", [
      id,
    ]),
    pool.query("SELECT name,team_index FROM players WHERE game_id=$1", [id]),
  ]);
  let current = null;
  if (game.current_instance) {
    const {
      rows: [row],
    } = await pool.query(
      `SELECT i.id,i.status,i.deadline,i.hint_used,i.multiplier,i.value,i.response,q.id AS question_id,q.text,q.format,q.options,q.media_id,q.media_alt,q.media_transcript,a.credit AS media_credit,a.license AS media_license,a.source AS media_source,CASE WHEN i.status IN('revealed','completed') THEN (SELECT json_agg(display_answer ORDER BY normalized_answer) FROM accepted_answers WHERE question_id=q.id) END AS accepted_answers,CASE WHEN i.status IN('revealed','completed') THEN q.ordering_answer END AS ordering_answer,CASE WHEN i.hint_used THEN q.hint END AS hint,CASE WHEN i.status IN('revealed','completed') THEN q.answer END AS answer,CASE WHEN i.status IN('revealed','completed') THEN q.explanation END AS explanation FROM game_questions i JOIN questions q ON q.id=i.question_id LEFT JOIN media_assets a ON a.id=q.media_id WHERE i.id=$1`,
      [game.current_instance],
    );
    current = row;
  }
  return {
    id: game.id,
    mode: game.mode,
    status: game.status,
    activeTeam: game.active_team,
    turnTeam: game.turn_team,
    timer: game.timer,
    stealing: game.stealing,
    lifelines: game.lifelines,
    teams: teams.rows,
    categories: categories.rows,
    tiles: tiles.rows,
    uses: uses.rows,
    players: players.rows,
    current,
    serverTime: Date.now(),
  };
}
export async function openQuestion(
  id: string,
  host: string,
  instanceId: string,
) {
  await transaction(async (db) => {
    const game = await lockGame(db, id, host);
    if (game.current_instance === instanceId) return;
    if (game.current_instance)
      throw new AppError(409, "QUESTION_OPEN", "أكمل السؤال الحالي أولًا.");
    const {
      rows: [q],
    } = await db.query(
      "SELECT * FROM game_questions WHERE id=$1 AND game_id=$2 AND status='available' FOR UPDATE",
      [instanceId, id],
    );
    if (!q) throw new AppError(409, "QUESTION_USED", "هذا السؤال غير متاح.");
    if (
      process.env.NODE_ENV === "production" &&
      (
        await db.query(
          "SELECT 1 FROM questions WHERE id=$1 AND development_only=true",
          [q.question_id],
        )
      ).rowCount
    )
      throw new AppError(
        409,
        "DEVELOPMENT_CONTENT",
        "هذا المحتوى تجريبي وغير متاح في الإنتاج.",
      );
    const participants = await db.query(
      "SELECT profile_id FROM game_participants WHERE game_id=$1 ORDER BY profile_id",
      [id],
    );
    const profiles = participants.rows.map((p) => p.profile_id);
    await db.query(
      "SELECT id FROM profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [profiles],
    );
    // Recheck exposure inside the locks, including history recently linked to an account.
    if (
      (
        await db.query(
          "SELECT 1 FROM exposures WHERE profile_id=ANY($1::uuid[]) AND question_id=$2",
          [profiles, q.question_id],
        )
      ).rowCount
    )
      throw new AppError(
        409,
        "ALREADY_SEEN",
        "شاهد أحد المشاركين هذا السؤال. ابدأ لعبة بفئات أخرى.",
      );
    for (const p of profiles)
      await db.query(
        "INSERT INTO exposures(profile_id,question_id,category_id,game_id,instance_id) VALUES($1,$2,$3,$4,$5)",
        [p, q.question_id, q.category_id, id, q.id],
      );
    await db.query(
      "UPDATE game_questions SET status='open',opened_at=now(),deadline=now()+($2*interval '1 second') WHERE id=$1",
      [q.id, game.timer],
    );
    await db.query(
      "UPDATE games SET current_instance=$2,turn_team=active_team,updated_at=now() WHERE id=$1",
      [id, q.id],
    );
  });
  return gameState(id, host);
}
export async function reveal(id: string, host: string) {
  await transaction(async (db) => {
    const game = await lockGame(db, id, host);
    if (!game.current_instance)
      throw new AppError(409, "NO_QUESTION", "اختر سؤالًا أولًا.");
    await db.query(
      "UPDATE game_questions SET status='revealed',revealed_at=COALESCE(revealed_at,now()) WHERE id=$1 AND status='open'",
      [game.current_instance],
    );
    await db.query(
      "UPDATE exposures SET answer_revealed=true WHERE instance_id=$1",
      [game.current_instance],
    );
  });
  return gameState(id, host);
}
export const scoreSchema = z
  .object({
    instanceId: z.uuid(),
    outcome: z.enum(["correct", "incorrect", "skipped"]),
    team: z.union([z.literal(0), z.literal(1)]).optional(),
  })
  .strict();
export async function score(id: string, host: string, input: unknown) {
  const action = scoreSchema.parse(input);
  await transaction(async (db) => {
    const {
      rows: [game],
    } = await db.query(
      "SELECT * FROM games WHERE id=$1 AND host_id=$2 FOR UPDATE",
      [id, host],
    );
    if (!game) throw new AppError(404, "GAME_NOT_FOUND", "اللعبة غير موجودة.");
    const {
      rows: [q],
    } = await db.query(
      "SELECT * FROM game_questions WHERE id=$1 AND game_id=$2 FOR UPDATE",
      [action.instanceId, id],
    );
    if (!q) throw new AppError(404, "QUESTION_NOT_FOUND", "السؤال غير موجود.");
    if (q.status === "completed") return; // Retries have no side effects, even after final tile.
    if (
      game.status !== "active" ||
      q.id !== game.current_instance ||
      q.status !== "revealed"
    )
      throw new AppError(
        409,
        "REVEAL_FIRST",
        "اكشف الإجابة قبل تسجيل النتيجة.",
      );
    const team = action.team ?? game.turn_team;
    if (
      action.outcome === "correct" &&
      team !== game.turn_team &&
      !game.stealing
    )
      throw new AppError(400, "STEAL_DISABLED", "خطف السؤال غير مفعّل.");
    const expired = new Date(q.deadline).getTime() < Date.now();
    if (action.outcome === "correct" && team === game.turn_team && expired)
      throw new AppError(
        409,
        "TIMER_EXPIRED",
        "انتهى الوقت. يمكن للفريق الآخر الخطف أو تجاوز السؤال.",
      );
    const points =
      action.outcome === "correct"
        ? q.value * (team === game.turn_team ? q.multiplier : 1)
        : action.outcome === "incorrect" && game.negative_scores
          ? -q.value
          : 0;
    const awarded =
      action.outcome === "correct"
        ? team
        : action.outcome === "incorrect"
          ? game.turn_team
          : null;
    await db.query(
      "INSERT INTO score_events(id,game_id,instance_id,team_index,points,outcome) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), id, q.id, awarded, points, action.outcome],
    );
    if (awarded !== null)
      await db.query(
        "UPDATE teams SET score=score+$3 WHERE game_id=$1 AND team_index=$2",
        [id, awarded, points],
      );
    await db.query(
      "UPDATE game_questions SET status='completed',outcome=$2,awarded_team=$3 WHERE id=$1",
      [q.id, action.outcome, awarded],
    );
    await db.query(
      "UPDATE exposures SET completed=true,outcome=$2 WHERE instance_id=$1",
      [q.id, action.outcome],
    );
    await db.query(
      "DELETE FROM reservations WHERE game_id=$1 AND question_id=$2",
      [id, q.question_id],
    );
    const remaining = await db.query(
      "SELECT 1 FROM game_questions WHERE game_id=$1 AND status!='completed' LIMIT 1",
      [id],
    );
    await db.query(
      "UPDATE games SET current_instance=null,active_team=1-turn_team,status=$2,updated_at=now() WHERE id=$1",
      [id, remaining.rowCount ? "active" : "finished"],
    );
  });
  return gameState(id, host);
}
export async function respond(id: string, host: string, input: unknown) {
  const response = z
    .object({
      items: z.array(z.string().max(200)).min(2).max(8).optional(),
      choice: z.string().max(200).optional(),
    })
    .strict()
    .parse(input);
  await transaction(async (db) => {
    const game = await lockGame(db, id, host);
    const {
      rows: [q],
    } = await db.query(
      "SELECT i.status,i.deadline,q.format,q.options FROM game_questions i JOIN questions q ON q.id=i.question_id WHERE i.id=$1 FOR UPDATE OF i",
      [game.current_instance],
    );
    if (
      !q ||
      q.status !== "open" ||
      new Date(q.deadline).getTime() < Date.now()
    )
      throw new AppError(409, "RESPONSE_CLOSED", "انتهى وقت الإجابة.");
    const valid =
      q.format === "ordering"
        ? response.items &&
          !response.choice &&
          JSON.stringify([...response.items].sort()) ===
            JSON.stringify([...q.options].sort())
        : q.format === "choice" &&
          response.choice &&
          !response.items &&
          q.options.includes(response.choice);
    if (!valid)
      throw new AppError(
        400,
        "RESPONSE_INVALID",
        "الإجابة لا تطابق خيارات السؤال.",
      );
    await db.query("UPDATE game_questions SET response=$2 WHERE id=$1", [
      game.current_instance,
      response,
    ]);
  });
  return gameState(id, host);
}
export async function lifeline(id: string, host: string, kind: string) {
  await transaction(async (db) => {
    const game = await lockGame(db, id, host);
    if (!game.current_instance || !game.lifelines.includes(kind))
      throw new AppError(
        400,
        "LIFELINE_UNAVAILABLE",
        "وسيلة المساعدة غير متاحة.",
      );
    const {
      rows: [q],
    } = await db.query("SELECT * FROM game_questions WHERE id=$1 FOR UPDATE", [
      game.current_instance,
    ]);
    if (q.status !== "open" || new Date(q.deadline).getTime() < Date.now())
      throw new AppError(
        409,
        "LIFELINE_CLOSED",
        "المساعدة متاحة أثناء السؤال وقبل انتهاء الوقت.",
      );
    const use = await db.query(
      "INSERT INTO lifeline_usage(game_id,team_index,kind,instance_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING kind",
      [id, game.turn_team, kind, q.id],
    );
    if (!use.rowCount)
      throw new AppError(
        409,
        "LIFELINE_USED",
        "استخدم فريقك هذه المساعدة بالفعل.",
      );
    if (kind === "hint")
      await db.query("UPDATE game_questions SET hint_used=true WHERE id=$1", [
        q.id,
      ]);
    if (kind === "double")
      await db.query("UPDATE game_questions SET multiplier=2 WHERE id=$1", [
        q.id,
      ]);
    if (kind === "extra-time")
      await db.query(
        "UPDATE game_questions SET deadline=deadline+interval '30 seconds' WHERE id=$1",
        [q.id],
      );
  });
  return gameState(id, host);
}
export async function abandon(id: string, host: string) {
  await transaction(async (db) => {
    await lockGame(db, id, host);
    await db.query(
      "UPDATE games SET status='abandoned',current_instance=null,updated_at=now() WHERE id=$1",
      [id],
    );
    await db.query("DELETE FROM reservations WHERE game_id=$1", [id]);
  });
  return gameState(id, host);
}
