import { Router } from "express";
import { limiter } from "./limits.ts";
import { wakeWorker } from "./worker.ts";
import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import { pool, transaction, AppError } from "./db.ts";
import {
  identity,
  hashPasswordAsync,
  checkPasswordAsync,
  setSession,
  mergeProfiles,
  requireEditor,
  tokenHash,
  cookieToken,
  updateRole,
} from "./auth.ts";
import {
  issueRecoveryKey,
  rotateRecoveryKey,
  recoverAccount,
} from "./recovery.ts";
import {
  createGame,
  gameState,
  openQuestion,
  reveal,
  score,
  lifeline,
  respond,
  abandon,
} from "./game.ts";
import {
  serveGameMedia,
  serveEditorMedia,
  mediaBody,
  uploadMedia,
  listEditorMedia,
} from "./media.ts";
import { submitQuestion } from "./submissions.ts";
import { getEditorialSuggestions } from "./editorial-suggestions.ts";
import {
  readLeaderboard,
  getLeaderboardPreference,
  setLeaderboardPreference,
} from "./leaderboard.ts";
import { integerSetting } from "./config.ts";
import {
  candidateSchema,
  ingest,
  ingestWith,
  publishCandidate,
  verifyCanonical,
  normalizeArabic,
} from "./content.ts";
export const api = Router();
api.use(identity);
api.use(limiter("profile"));
api.get("/games/:id/media/:instanceId", serveGameMedia);
api.post("/games/:id/response", async (req, res) =>
  res.json(
    await respond(
      z.uuid().parse(req.params.id),
      req.identity.profileId,
      req.body,
    ),
  ),
);
api.post("/admin/media", requireEditor, mediaBody, uploadMedia);
api.get("/admin/media", requireEditor, async (req, res) =>
  res.json(
    await listEditorMedia(
      z.enum(["image", "audio", "video"]).optional().parse(req.query.format),
      z.string().optional().parse(req.query.cursor),
      z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .parse(req.query.limit),
    ),
  ),
);
api.get("/admin/media/:assetId", requireEditor, serveEditorMedia);
api.get("/leaderboard", async (req, res) =>
  res.json(await readLeaderboard(req.query)),
);
api.get("/account/leaderboard", async (req, res) =>
  res.json(await getLeaderboardPreference(req.identity.profileId)),
);
api.post("/account/leaderboard", async (req, res) => {
  const b = z.object({ enabled: z.boolean() }).strict().parse(req.body);
  res.json(await setLeaderboardPreference(req.identity.profileId, b.enabled));
});
const credentials = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,30}$/),
    password: z.string().min(10).max(128),
  })
  .strict();
api.get("/me", async (req, res) => {
  const {
    rows: [counts],
  } = await pool.query(
    "SELECT count(*)::int AS seen FROM exposures WHERE profile_id=$1",
    [req.identity.profileId],
  );
  res.json({ ...req.identity, seen: counts.seen });
});
api.post("/auth/register", async (req, res) => {
  if (req.identity.userId)
    throw new AppError(409, "SIGNED_IN", "أنت مسجّل بالفعل.");
  const c = credentials.parse(req.body),
    userId = randomUUID(),
    profile = req.identity.profileId;
  const passwordHash = await hashPasswordAsync(c.password);
  const recoveryKey = await transaction(async (db) => {
    await db.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [profile]);
    if (
      (await db.query("SELECT 1 FROM users WHERE username=$1", [c.username]))
        .rowCount
    )
      throw new AppError(409, "USERNAME_TAKEN", "اسم المستخدم مستخدم بالفعل.");
    await db.query(
      "INSERT INTO users(id,profile_id,username,password_hash) VALUES($1,$2,$3,$4)",
      [userId, profile, c.username, passwordHash],
    );
    await db.query("UPDATE profiles SET kind='account' WHERE id=$1", [profile]);
    return issueRecoveryKey(db, userId);
  });
  // Rotate session after authentication; no lost guest history.
  await pool.query("DELETE FROM sessions WHERE profile_id=$1", [profile]);
  await setSession(res, profile);
  res.json({ ok: true, recoveryKey });
});
api.post("/auth/login", async (req, res) => {
  const c = credentials.parse(req.body);
  const {
    rows: [u],
  } = await pool.query("SELECT * FROM users WHERE username=$1", [c.username]);
  if (!u || !(await checkPasswordAsync(c.password, u.password_hash)))
    throw new AppError(
      401,
      "LOGIN_FAILED",
      "اسم المستخدم أو كلمة المرور غير صحيحة.",
    );
  await mergeProfiles(req.identity.profileId, u.profile_id);
  const token = cookieToken(req);
  if (token)
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      tokenHash(token),
    ]);
  await setSession(res, u.profile_id);
  res.json({ ok: true });
});
api.post("/auth/recover", async (req, res) => {
  const b = credentials
    .extend({ recoveryKey: z.string().min(48).max(80) })
    .parse(req.body);
  const recoveryKey = await recoverAccount(
    b.username,
    b.recoveryKey,
    b.password,
  );
  res.json({ ok: true, recoveryKey });
});
api.post("/auth/recovery-key", async (req, res) => {
  if (!req.identity.userId)
    throw new AppError(401, "ACCOUNT_REQUIRED", "سجّل الدخول أولًا.");
  const b = z
    .object({ password: z.string().min(1).max(128) })
    .strict()
    .parse(req.body);
  res.json({
    recoveryKey: await rotateRecoveryKey(req.identity.userId, b.password),
  });
});
api.post("/auth/logout", async (req, res) => {
  const token = cookieToken(req);
  if (token)
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      tokenHash(token),
    ]);
  res.clearCookie("nabeeh_session", { path: "/" });
  res.json({ ok: true });
});
api.post("/participants/token", async (req, res) => {
  if (!req.identity.userId)
    throw new AppError(
      401,
      "ACCOUNT_REQUIRED",
      "سجّل الدخول لمشاركة سجلّك مع المضيف.",
    );
  const token = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO participant_tokens VALUES($1,$2,now()+interval '10 minutes',null)",
    [tokenHash(token), req.identity.profileId],
  );
  res.json({ token, expiresIn: 600 });
});
api.get("/categories", async (req, res) => {
  const filter = z
    .object({
      q: z.string().max(100).default(""),
      region: z
        .enum(["all", "sa", "kw", "ae", "bh", "qa", "om"])
        .default("all"),
      difficulty: z
        .enum(["all", "easy", "medium", "hard", "expert"])
        .default("all"),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .parse(req.query);
  const { rows } = await pool.query(
    `SELECT c.*,EXISTS(SELECT 1 FROM favorites f WHERE f.category_id=c.id AND f.profile_id=$1) AS favorite,count(q.id)::int AS total,count(q.id) FILTER(WHERE e.profile_id IS NULL AND r.profile_id IS NULL)::int AS available,count(q.id) FILTER(WHERE q.difficulty='easy' AND e.profile_id IS NULL AND r.profile_id IS NULL)::int AS easy,count(q.id) FILTER(WHERE q.difficulty='medium' AND e.profile_id IS NULL AND r.profile_id IS NULL)::int AS medium,count(q.id) FILTER(WHERE q.difficulty='hard' AND e.profile_id IS NULL AND r.profile_id IS NULL)::int AS hard FROM categories c LEFT JOIN question_categories qc ON qc.category_id=c.id LEFT JOIN questions q ON q.id=qc.question_id AND q.status='approved' AND ($6=false OR q.development_only=false) AND (q.expires_at IS NULL OR q.expires_at>now()) AND ($3='all' OR q.region IN('all',$3)) AND ($4='all' OR q.difficulty=$4) LEFT JOIN exposures e ON e.profile_id=$1 AND e.question_id=q.id LEFT JOIN reservations r ON r.profile_id=$1 AND r.question_id=q.id WHERE (c.name ILIKE $2 OR c.description ILIKE $2) AND ($3='all' OR c.region IN('all',$3)) GROUP BY c.id ORDER BY c.id LIMIT 60 OFFSET $5`,
    [
      req.identity.profileId,
      "%" + filter.q + "%",
      filter.region,
      filter.difficulty,
      (filter.page - 1) * 60,
      process.env.NODE_ENV === "production",
    ],
  );
  res.json(rows);
});
api.post("/favorites", async (req, res) => {
  const body = z
    .object({ categoryId: z.string().max(80), favorite: z.boolean() })
    .strict()
    .parse(req.body);
  if (body.favorite)
    await pool.query(
      "INSERT INTO favorites VALUES($1,$2) ON CONFLICT DO NOTHING",
      [req.identity.profileId, body.categoryId],
    );
  else
    await pool.query(
      "DELETE FROM favorites WHERE profile_id=$1 AND category_id=$2",
      [req.identity.profileId, body.categoryId],
    );
  res.json({ ok: true });
});
api.get("/games", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id,g.status,g.mode,g.created_at,count(i.id) FILTER(WHERE i.status='completed')::int AS completed,count(i.id)::int AS total FROM games g LEFT JOIN game_questions i ON i.game_id=g.id WHERE g.host_id=$1 GROUP BY g.id ORDER BY g.created_at DESC LIMIT 30`,
    [req.identity.profileId],
  );
  res.json(rows);
});
api.post("/games", async (req, res) =>
  res.status(201).json(await createGame(req.identity.profileId, req.body)),
);
api.get("/games/:id", async (req, res) =>
  res.json(
    await gameState(z.uuid().parse(req.params.id), req.identity.profileId),
  ),
);
api.post("/games/:id/open", async (req, res) =>
  res.json(
    await openQuestion(
      z.uuid().parse(req.params.id),
      req.identity.profileId,
      z.object({ instanceId: z.uuid() }).strict().parse(req.body).instanceId,
    ),
  ),
);
api.post("/games/:id/reveal", async (req, res) =>
  res.json(await reveal(z.uuid().parse(req.params.id), req.identity.profileId)),
);
api.post("/games/:id/score", async (req, res) =>
  res.json(
    await score(
      z.uuid().parse(req.params.id),
      req.identity.profileId,
      req.body,
    ),
  ),
);
api.post("/games/:id/lifeline", async (req, res) =>
  res.json(
    await lifeline(
      z.uuid().parse(req.params.id),
      req.identity.profileId,
      z
        .object({ kind: z.enum(["hint", "double", "extra-time"]) })
        .strict()
        .parse(req.body).kind,
    ),
  ),
);
api.post("/games/:id/abandon", async (req, res) =>
  res.json(
    await abandon(z.uuid().parse(req.params.id), req.identity.profileId),
  ),
);
api.post("/reports", async (req, res) => {
  const b = z
    .object({
      questionId: z.uuid(),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict()
    .parse(req.body);
  const authorized = await pool.query(
    "SELECT 1 FROM exposures WHERE profile_id=$1 AND question_id=$2",
    [req.identity.profileId, b.questionId],
  );
  if (!authorized.rowCount)
    throw new AppError(
      403,
      "FORBIDDEN",
      "يمكن الإبلاغ عن الأسئلة التي شاهدتها فقط.",
    );
  await pool.query(
    "INSERT INTO reports(id,profile_id,question_id,reason) VALUES($1,$2,$3,$4)",
    [randomUUID(), req.identity.profileId, b.questionId, b.reason],
  );
  res.json({ ok: true });
});
api.get("/account/export", async (req, res) => {
  const [exposures, games, favorites, participation, preferences] =
    await Promise.all([
      pool.query(
        "SELECT question_id,category_id,shown_at,answer_revealed,outcome,completed FROM exposures WHERE profile_id=$1",
        [req.identity.profileId],
      ),
      pool.query("SELECT id,status,created_at FROM games WHERE host_id=$1", [
        req.identity.profileId,
      ]),
      pool.query("SELECT category_id FROM favorites WHERE profile_id=$1", [
        req.identity.profileId,
      ]),
      pool.query(
        "SELECT game_id,team_index FROM game_participants WHERE profile_id=$1",
        [req.identity.profileId],
      ),
      pool.query("SELECT leaderboard_enabled FROM users WHERE profile_id=$1", [
        req.identity.profileId,
      ]),
    ]);
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="nabeeh-data.json"',
  );
  res.json({
    profile: req.identity,
    exposures: exposures.rows,
    games: games.rows,
    favorites: favorites.rows,
    participation: participation.rows,
    leaderboardEnabled: preferences.rows[0]?.leaderboard_enabled ?? false,
  });
});
api.delete("/account", async (req, res) => {
  const b = z
    .object({
      confirm: z.literal("DELETE"),
      password: z.string().max(128).optional(),
    })
    .strict()
    .parse(req.body);
  if (req.identity.userId) {
    const {
      rows: [u],
    } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [
      req.identity.userId,
    ]);
    if (!b.password || !(await checkPasswordAsync(b.password, u.password_hash)))
      throw new AppError(
        401,
        "PASSWORD_REQUIRED",
        "أدخل كلمة المرور لحذف الحساب.",
      );
  }
  await transaction(async (db) => {
    const p = req.identity.profileId;
    // Remove the whole participant ledger for this profile. Aggregate audit may remain anonymized.
    await db.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [p]);
    await db.query("DELETE FROM exposures WHERE profile_id=$1", [p]);
    await db.query("DELETE FROM reservations WHERE profile_id=$1", [p]);
    await db.query(
      "DELETE FROM reservations WHERE game_id IN(SELECT id FROM games WHERE host_id=$1)",
      [p],
    );
    // Preserve other participants' exposure history while removing ownership and names.
    const tombstone = randomUUID();
    await db.query("INSERT INTO profiles(id,kind) VALUES($1,'guest')", [
      tombstone,
    ]);
    await db.query(
      "UPDATE teams SET name=CASE WHEN team_index=0 THEN 'الفريق الأول' ELSE 'الفريق الثاني' END WHERE game_id IN(SELECT id FROM games WHERE host_id=$1)",
      [p],
    );
    await db.query(
      "DELETE FROM players WHERE game_id IN(SELECT id FROM games WHERE host_id=$1)",
      [p],
    );
    await db.query(
      "UPDATE games SET host_id=$2,status=CASE WHEN status='active' THEN 'abandoned' ELSE status END,current_instance=null WHERE host_id=$1",
      [p, tombstone],
    );
    await db.query("DELETE FROM game_participants WHERE profile_id=$1", [p]);
    await db.query("UPDATE players SET profile_id=null WHERE profile_id=$1", [
      p,
    ]);
    await db.query(
      "UPDATE questions SET reviewed_by=null WHERE reviewed_by=$1",
      [req.identity.userId],
    );
    await db.query(
      "UPDATE review_tasks SET assigned_to=null WHERE assigned_to=$1",
      [req.identity.userId],
    );
    await db.query("DELETE FROM users WHERE profile_id=$1", [p]);
    await db.query("DELETE FROM profiles WHERE id=$1", [p]);
  });
  res.clearCookie("nabeeh_session", { path: "/" });
  res.json({ ok: true });
});
api.use("/admin", requireEditor);
api.post("/admin/submissions", async (req, res) =>
  res.status(201).json(await submitQuestion(req.body, req.identity.userId!)),
);
api.get("/admin/suggestions", async (_req, res) =>
  res.json(await getEditorialSuggestions()),
);
api.get("/admin/review-queue", async (req, res) => {
  const filter = z
    .object({
      status: z
        .enum(["review", "duplicate", "approved", "rejected"])
        .default("review"),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      categoryId: z.string().max(80).default(""),
      difficulty: z.enum(["", "easy", "medium", "hard", "expert"]).default(""),
    })
    .parse(req.query);
  const params = [filter.status, filter.categoryId, filter.difficulty];
  const where =
    "c.status=$1 AND ($2='' OR c.payload->'categoryIds' ? $2) AND ($3='' OR c.payload->>'difficulty'=$3)";
  const [items, total, counts] = await Promise.all([
    pool.query(
      `SELECT c.*,COALESCE((SELECT json_agg(json_build_object('id',q.id,'text',q.text,'answer',q.answer,'score',d.score)) FROM duplicate_candidates d JOIN questions q ON q.id=d.question_id WHERE d.candidate_id=c.id),'[]') AS duplicates FROM candidates c WHERE ${where} ORDER BY c.created_at DESC,c.id LIMIT 12 OFFSET $4`,
      [...params, (filter.page - 1) * 12],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM candidates c WHERE ${where}`,
      params,
    ),
    pool.query(
      "SELECT status,count(*)::int AS count FROM candidates GROUP BY status",
    ),
  ]);
  res.json({
    items: items.rows,
    page: filter.page,
    total: total.rows[0].count,
    totalPages: Math.ceil(total.rows[0].count / 12),
    counts: {
      review: 0,
      duplicate: 0,
      approved: 0,
      rejected: 0,
      ...Object.fromEntries(counts.rows.map((c) => [c.status, c.count])),
    },
  });
});
api.get("/admin/access", async (req, res) => {
  if (req.identity.role !== "admin")
    throw new AppError(
      403,
      "ADMIN_REQUIRED",
      "تعديل صلاحيات المستخدمين متاح للمدير فقط.",
    );
  const { rows } = await pool.query(
    "SELECT id,username,role,created_at FROM users ORDER BY created_at DESC LIMIT 100",
  );
  res.json(rows);
});
api.post("/admin/access/:id", async (req, res) => {
  const b = z
    .object({
      role: z.enum(["player", "editor", "admin"]),
      reason: z.string().trim().min(12).max(1000),
    })
    .strict()
    .parse(req.body);
  await updateRole(
    req.identity.userId!,
    z.uuid().parse(req.params.id),
    b.role,
    b.reason,
  );
  res.json({ ok: true });
});
api.get("/admin/metrics", async (_req, res) => {
  const [games, content, exposures, profiles, budget] = await Promise.all([
    pool.query(
      "SELECT status,mode,count(*)::int AS count FROM games GROUP BY status,mode",
    ),
    pool.query(
      "SELECT status,count(*)::int AS count FROM candidates GROUP BY status",
    ),
    pool.query(
      "SELECT count(*)::int AS shown,count(*) FILTER(WHERE completed)::int AS completed FROM exposures",
    ),
    pool.query(
      "SELECT kind,count(*)::int AS count FROM profiles GROUP BY kind",
    ),
    pool.query(
      "SELECT day,reserved_cents FROM generation_budget ORDER BY day DESC LIMIT 30",
    ),
  ]);
  res.json({
    games: games.rows,
    content: content.rows,
    exposures: exposures.rows[0],
    profiles: profiles.rows,
    budget: budget.rows,
  });
});
api.get("/admin/overview", async (_req, res) => {
  const [questions, candidates, jobs, reports, audit, inventory] =
    await Promise.all([
      pool.query(
        "SELECT status,count(*)::int AS count FROM questions GROUP BY status",
      ),
      pool.query(
        "SELECT c.*,COALESCE((SELECT json_agg(json_build_object('id',q.id,'text',q.text,'answer',q.answer,'score',d.score)) FROM duplicate_candidates d JOIN questions q ON q.id=d.question_id WHERE d.candidate_id=c.id),'[]') AS duplicates FROM candidates c ORDER BY created_at DESC LIMIT 100",
      ),
      pool.query(
        "SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT 40",
      ),
      pool.query("SELECT * FROM reports ORDER BY created_at DESC LIMIT 50"),
      pool.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 40"),
      pool.query(
        "SELECT c.id,c.name,count(q.id)::int AS total FROM categories c LEFT JOIN question_categories qc ON qc.category_id=c.id LEFT JOIN questions q ON q.id=qc.question_id AND q.status='approved' GROUP BY c.id ORDER BY c.id",
      ),
    ]);
  res.json({
    questions: questions.rows,
    candidateCounts: Object.fromEntries(
      (
        await pool.query(
          "SELECT status,count(*)::int AS count FROM candidates GROUP BY status",
        )
      ).rows.map((c) => [c.status, c.count]),
    ),
    candidates: candidates.rows,
    jobs: jobs.rows,
    reports: reports.rows,
    audit: audit.rows,
    inventory: inventory.rows,
    replenishment: (
      await pool.query(
        "SELECT r.*,c.name FROM replenishment_requests r JOIN categories c ON c.id=r.category_id WHERE resolved_at IS NULL ORDER BY requested_at DESC LIMIT 100",
      )
    ).rows,
  });
});
api.post("/admin/candidates", async (req, res) => {
  res.status(201).json(await ingest(req.body));
});
api.post("/admin/candidates/:id/edit", async (req, res) => {
  const id = z.uuid().parse(req.params.id),
    b = z
      .object({
        candidate: candidateSchema,
        reason: z.string().min(12).max(2000),
        expectedRevision: z.number().int().min(1),
      })
      .strict()
      .parse(req.body);
  const result = await transaction(async (db) => {
    const {
      rows: [prior],
    } = await db.query(
      "SELECT payload,status,revision FROM candidates WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!prior || !["review", "duplicate"].includes(prior.status))
      throw new AppError(409, "NOT_REVIEWABLE", "المسودة غير متاحة للتعديل.");
    if (prior.revision !== b.expectedRevision)
      throw new AppError(
        409,
        "REVIEW_CHANGED",
        "تغيّرت المسودة. حدّث القائمة قبل التعديل.",
      );
    const next = await ingestWith(db, b.candidate, id);
    await db.query(
      "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'edit-candidate',$2,$3)",
      [
        req.identity.userId,
        id,
        { reason: b.reason, priorPayload: prior.payload },
      ],
    );
    return next;
  });
  res.json(result);
});
api.post("/admin/replenishment/resolve", async (req, res) => {
  const b = z
    .object({
      categoryId: z.string().max(80),
      difficulty: z.string().max(30),
      region: z.string().max(10),
    })
    .strict()
    .parse(req.body);
  await pool.query(
    "UPDATE replenishment_requests SET resolved_at=now() WHERE category_id=$1 AND difficulty=$2 AND region=$3",
    [b.categoryId, b.difficulty, b.region],
  );
  res.json({ ok: true });
});
api.post("/admin/import", async (req, res) => {
  const list = z.array(candidateSchema).min(1).max(100).parse(req.body);
  const results = [];
  for (const c of list) results.push(await ingest(c));
  res.json(results);
});
api.get("/admin/export", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT c.payload,c.status,c.verification_note FROM candidates c ORDER BY created_at",
  );
  res.json(rows);
});
api.post("/admin/candidates/:id/review", async (req, res) => {
  const id = z.uuid().parse(req.params.id),
    b = z
      .object({
        action: z.enum(["approve", "reject"]),
        verificationNote: z.string().trim().min(12).max(2000),
        duplicateReviewed: z.boolean().default(false),
        expectedRevision: z.number().int().min(1),
        difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
        categoryIds: z
          .array(z.string().min(1).max(80))
          .min(1)
          .max(5)
          .optional(),
      })
      .strict()
      .parse(req.body);
  await transaction(async (db) => {
    const {
      rows: [current],
    } = await db.query(
      "SELECT revision,status,payload FROM candidates WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      !current ||
      !["review", "duplicate"].includes(current.status) ||
      (b.action === "approve" && current.status !== "review")
    )
      throw new AppError(
        409,
        "NOT_REVIEWABLE",
        "المسودة غير متاحة لهذا القرار.",
      );
    if (current.revision !== b.expectedRevision)
      throw new AppError(
        409,
        "REVIEW_CHANGED",
        "تغيّرت المسودة. حدّث القائمة وأعد المراجعة.",
      );
    const classified = candidateSchema.parse({
      ...current.payload,
      difficulty: b.difficulty ?? current.payload.difficulty,
      categoryIds: b.categoryIds ?? current.payload.categoryIds,
    });
    let revision = current.revision;
    if (
      classified.difficulty !== current.payload.difficulty ||
      JSON.stringify(classified.categoryIds) !==
        JSON.stringify(current.payload.categoryIds)
    ) {
      const edited = await ingestWith(db, classified, id);
      if (b.action === "approve" && edited.status !== "review")
        throw new AppError(
          409,
          "DUPLICATE",
          "السؤال يكرر محتوى موجودًا؛ عدّل المسودة أو ارفضها.",
        );
      revision++;
      await db.query(
        "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'classify-candidate',$2,$3)",
        [
          req.identity.userId,
          id,
          {
            priorDifficulty: current.payload.difficulty,
            difficulty: classified.difficulty,
            priorCategoryIds: current.payload.categoryIds,
            categoryIds: classified.categoryIds,
          },
        ],
      );
    }
    if (b.action === "approve")
      await publishCandidate(
        db,
        id,
        req.identity.userId!,
        b.verificationNote,
        b.duplicateReviewed,
        revision,
      );
    else {
      await db.query(
        "UPDATE candidates SET status='rejected',reason=$2,verification_note=$2 WHERE id=$1 AND status IN('review','duplicate')",
        [id, b.verificationNote],
      );
      await db.query(
        "UPDATE review_tasks SET status='resolved',resolved_at=now() WHERE candidate_id=$1",
        [id],
      );
      await db.query(
        "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'reject-question',$2,$3)",
        [req.identity.userId, id, { reason: b.verificationNote }],
      );
    }
  });
  res.json({ ok: true });
});
api.post("/admin/questions/:id/verify", async (req, res) => {
  const id = z.uuid().parse(req.params.id),
    b = z
      .object({
        sources: z
          .array(
            z.object({
              url: z
                .string()
                .url()
                .refine((v) => v.startsWith("https://")),
              citation: z.string().min(5).max(1000),
            }),
          )
          .max(10),
        note: z.string().trim().min(12).max(2000),
        verifiedFact: z.string().max(1000).optional(),
      })
      .strict()
      .parse(req.body);
  await transaction((db) =>
    verifyCanonical(
      db,
      id,
      req.identity.userId!,
      b.sources,
      b.note,
      b.verifiedFact,
    ),
  );
  res.json({ ok: true });
});
api.get("/admin/questions", async (req, res) => {
  const q = z
    .string()
    .max(100)
    .parse(req.query.q ?? "");
  const { rows } = await pool.query(
    "SELECT id,text,answer,difficulty,status,verified_at,fact_key,development_only FROM questions WHERE text ILIKE $1 ORDER BY created_at DESC LIMIT 100",
    ["%" + q + "%"],
  );
  res.json(rows);
});
api.post("/admin/questions/:id/status", async (req, res) => {
  const id = z.uuid().parse(req.params.id),
    b = z
      .object({
        status: z.enum(["archived", "retired"]),
        reason: z.string().min(5).max(500),
      })
      .strict()
      .parse(req.body);
  await transaction(async (db) => {
    await db.query("UPDATE questions SET status=$2 WHERE id=$1", [
      id,
      b.status,
    ]);
    await db.query(
      "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,$2,$3,$4)",
      [req.identity.userId, b.status, id, { reason: b.reason }],
    );
  });
  res.json({ ok: true });
});
api.post("/admin/questions/:id/edit", async (req, res) => {
  const id = z.uuid().parse(req.params.id),
    b = z
      .object({
        text: z.string().min(8).max(600),
        answer: z.string().min(1).max(300),
        aliases: z.array(z.string().min(1).max(300)).max(20),
        explanation: z.string().min(8).max(2000),
        hint: z.string().min(2).max(300),
        categoryIds: z.array(z.string().max(80)).min(1).max(5),
        reason: z.string().min(12).max(2000),
      })
      .strict()
      .parse(req.body);
  await transaction(async (db) => {
    const {
      rows: [q],
    } = await db.query("SELECT * FROM questions WHERE id=$1 FOR UPDATE", [id]);
    if (!q) throw new AppError(404, "NOT_FOUND", "السؤال غير موجود.");
    // Wording/category corrections retain canonical identity and exposure history.
    // Changes to the underlying fact must be a separate reviewed candidate.
    if (normalizeArabic(q.answer) !== normalizeArabic(b.answer))
      throw new AppError(
        409,
        "FACT_CHANGE",
        "تغيير الحقيقة يتطلّب مرشّحًا مستقلًّا. تعديل الصياغة يحفظ هوية السؤال.",
      );
    const { contentDigest } = await import("./content.ts");
    const hash = await contentDigest(db, {
      text: b.text,
      format: q.format,
      options: q.options,
      ...(q.media_id ? { media: { assetId: q.media_id } } : {}),
    });
    if (
      (
        await db.query(
          "SELECT 1 FROM questions WHERE id!=$1 AND normalized_hash=$2",
          [id, hash],
        )
      ).rowCount
    )
      throw new AppError(409, "DUPLICATE", "الصياغة موجودة لسؤال آخر.");
    await db.query(
      "UPDATE questions SET text=$2,normalized_hash=$3,explanation=$4,hint=$5 WHERE id=$1",
      [id, b.text, hash, b.explanation, b.hint],
    );
    await db.query("DELETE FROM question_categories WHERE question_id=$1", [
      id,
    ]);
    for (const cat of b.categoryIds)
      await db.query("INSERT INTO question_categories VALUES($1,$2)", [
        id,
        cat,
      ]);
    await db.query("DELETE FROM accepted_answers WHERE question_id=$1", [id]);
    for (const answer of [q.answer, ...b.aliases])
      await db.query(
        "INSERT INTO accepted_answers VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, normalizeArabic(answer), answer],
      );
    await db.query(
      "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'edit-question',$2,$3)",
      [req.identity.userId, id, { reason: b.reason, priorText: q.text }],
    );
  });
  res.json({ ok: true });
});
api.post("/admin/jobs", async (req, res) => {
  const b = z
    .object({
      categoryId: z.string().max(80),
      kind: z.enum(["arithmetic", "model"]),
      count: z.number().int().min(1).max(20),
      difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
      format: z.enum(["text", "choice", "ordering", "word"]).default("text"),
      region: z
        .enum(["all", "sa", "kw", "ae", "bh", "qa", "om"])
        .default("all"),
    })
    .strict()
    .parse(req.body);
  if (
    b.kind === "arithmetic" &&
    (b.categoryId !== "logic" || b.format !== "text")
  )
    throw new AppError(
      400,
      "CATEGORY_MISMATCH",
      "التوليد الحسابي متاح لفئة الألغاز فقط.",
    );
  if (
    !(await pool.query("SELECT 1 FROM categories WHERE id=$1", [b.categoryId]))
      .rowCount
  )
    throw new AppError(400, "CATEGORY_INVALID", "الفئة المختارة غير موجودة.");
  if (
    b.kind === "model" &&
    (!process.env.MODEL_API_KEY ||
      integerSetting("GENERATION_DAILY_BUDGET_CENTS", 0, 0, 100000) === 0)
  )
    throw new AppError(
      409,
      "GENERATION_DISABLED",
      "توليد الأسئلة بالذكاء الاصطناعي غير مفعّل. يمكنك إضافة الأسئلة ومراجعة الاقتراحات يدويًا.",
    );
  const queued = await pool.query(
    "INSERT INTO generation_jobs(id,category_id,kind,count,target_difficulty,target_format,target_region) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",
    [
      randomUUID(),
      b.categoryId,
      b.kind,
      b.count,
      b.difficulty ?? null,
      b.format,
      b.region,
    ],
  );
  if (!queued.rowCount)
    throw new AppError(
      409,
      "JOB_PENDING",
      "توجد مهمة قيد التنفيذ لهذه الفئة. راجعها قبل إضافة مهمة أخرى.",
    );
  wakeWorker();
  res.json({ ok: true });
});
api.post("/admin/reports/:id/resolve", async (req, res) => {
  await pool.query("UPDATE reports SET status='resolved' WHERE id=$1", [
    z.uuid().parse(req.params.id),
  ]);
  res.json({ ok: true });
});
api.post("/admin/categories", async (req, res) => {
  const b = z
    .object({
      id: z.string().regex(/^[a-z0-9-]{2,60}$/),
      name: z.string().min(2).max(100),
      description: z.string().min(5).max(300),
      parentId: z.string().nullable().default(null),
      region: z
        .enum(["all", "sa", "kw", "ae", "bh", "qa", "om"])
        .default("all"),
      tags: z.array(z.string().max(40)).max(12).default([]),
    })
    .strict()
    .parse(req.body);
  await pool.query(
    "INSERT INTO categories(id,name,description,parent_id,region,tags,icon,color) VALUES($1,$2,$3,$4,$5,$6,'✦','#e6e9dd') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,parent_id=EXCLUDED.parent_id,region=EXCLUDED.region,tags=EXCLUDED.tags",
    [b.id, b.name, b.description, b.parentId, b.region, b.tags],
  );
  res.json({ ok: true });
});
