import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { Server } from "node:http";
import pg from "pg";
import { ZodError } from "zod";

const base =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
const isolated = new URL(base);
if (
  !process.env.TEST_DATABASE_URL &&
  !["localhost", "127.0.0.1"].includes(isolated.hostname)
)
  throw new Error(
    "External answer-media tests require an explicit isolated TEST_DATABASE_URL ending in _test.",
  );
if (process.env.TEST_DATABASE_URL && !isolated.pathname.endsWith("_test"))
  throw new Error("Answer-media integration database name must end in _test.");
const databaseName =
  "answer_media_" + randomUUID().replaceAll("-", "") + "_test";
isolated.pathname = "/" + databaseName;
process.env.DATABASE_URL = isolated.href;
delete process.env.MEDIA_BUCKET;
delete process.env.MEDIA_ACCESS_KEY_ID;
delete process.env.MEDIA_SECRET_ACCESS_KEY;
const { pool, transaction, AppError } = await import("../server/db.ts");
const { tokenHash } = await import("../server/auth.ts");
const {
  candidateSchema,
  ingest,
  ingestWith,
  publishCandidate,
  insertQuestion,
} = await import("../server/content.ts");
const { submitQuestion } = await import("../server/submissions.ts");
const game = await import("../server/game.ts");
const { api } = await import("../server/api.ts");
let server: Server | undefined;
let origin = "",
  editorCookie = "",
  guestCookie = "",
  editorProfile = "",
  editorId = "";
let createdDatabase = false;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const metadata = {
  "x-media-credit": encodeURIComponent("رسام الإجابة للاختبار"),
  "x-media-license": encodeURIComponent("عمل أصلي للاختبار فقط"),
  "x-media-source": "https%3A%2F%2Fexample.com%2Fanswer",
};

async function createSession(editor = false) {
  const profileId = randomUUID(),
    userId = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO profiles(id,kind) VALUES($1,$2)", [
    profileId,
    editor ? "account" : "guest",
  ]);
  if (editor)
    await pool.query(
      "INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,'unused-fixture-hash','editor')",
      [userId, profileId, "answer_" + profileId.slice(0, 8)],
    );
  await pool.query(
    "INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(token), profileId],
  );
  return { profileId, userId, cookie: "nabeeh_session=" + token };
}
async function request(path: string, body?: unknown, cookie = editorCookie) {
  return fetch(origin + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function image(bytes = png) {
  const response = await fetch(origin + "/api/admin/media", {
    method: "POST",
    headers: { cookie: editorCookie, "content-type": "image/png", ...metadata },
    body: new Uint8Array(bytes),
  });
  assert.equal(response.status, 201);
  return (await response.json()).id as string;
}
function draft(answerAsset: string) {
  const nonce = randomUUID();
  return {
    text: "أي شكل يطابق النمط الهندسي في هذا الاختبار " + nonce,
    answer: "المثلث الذهبي " + nonce,
    explanation:
      "الصورة الصحيحة تكمل النمط وفق ترتيب الأشكال المعروض في اللغز.",
    hint: "تأمل ترتيب الأشكال.",
    categoryIds: ["answer-media-test"],
    difficulty: "easy",
    format: "text",
    answerMedia: { assetId: answerAsset },
  };
}
function advanced(
  answerAsset: string,
  overrides: Record<string, unknown> = {},
) {
  const d = draft(answerAsset),
    nonce = randomUUID();
  return candidateSchema.parse({
    ...d,
    evidenceKind: "original",
    provenance: "لغز هندسي أصلي خاص باختبار الإجابة المصورة.",
    fact: "دليل حل هندسي أصلي لهذا السؤال فقط: " + nonce,
    factKey: "answer-media:" + nonce,
    subject: nonce,
    predicate: "shape",
    answerMedia: { assetId: answerAsset, alt: "المثلث الذهبي الذي يكمل النمط" },
    ...overrides,
  });
}

before(async () => {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE "' + databaseName + '"');
    createdDatabase = true;
  } finally {
    await admin.end();
  }
  execFileSync("node", ["--import", "tsx", "scripts/migrate.ts"], {
    env: process.env,
  });
  const editor = await createSession(true);
  editorCookie = editor.cookie;
  editorProfile = editor.profileId;
  editorId = editor.userId;
  guestCookie = (await createSession()).cookie;
  await pool.query(
    "INSERT INTO categories(id,name,description,icon,color) VALUES('answer-media-test','إجابات مصورة للاختبار','فئة معزولة للاختبار','◯','#eee')",
  );
  const app = express();
  app.use(express.json());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", api);
  app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND" }));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) =>
    res
      .status(
        error instanceof AppError
          ? error.status
          : error instanceof ZodError || error.code === "23503"
            ? 400
            : 500,
      )
      .json({ code: error.code || "INVALID_INPUT" }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = "http://127.0.0.1:" + address.port;
});
beforeEach(async () => {
  await pool.query("TRUNCATE games,questions,candidates,media_assets CASCADE");
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await pool.end();
  if (createdDatabase) {
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    try {
      await admin.query('DROP DATABASE "' + databaseName + '"');
    } finally {
      await admin.end();
    }
  }
});

test("Answer images survive guided submission, revision, approval, export and wording corrections", async () => {
  const assetId = await image(),
    input = draft(assetId);
  const submitted = await request("/admin/submissions", input);
  assert.equal(submitted.status, 201);
  const { id } = await submitted.json();
  let candidate = (
    await pool.query("SELECT * FROM candidates WHERE id=$1", [id])
  ).rows[0];
  assert.equal(candidate.status, "review");
  assert.deepEqual(candidate.payload.answerMedia, {
    assetId,
    alt: "صورة الإجابة الصحيحة",
  });
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM questions")).rows[0].n,
    0,
  );
  const edited = {
    ...candidate.payload,
    explanation:
      "تؤكد مراجعة النمط أن الصورة المرفقة تمثل الإجابة الصحيحة لهذا اللغز.",
  };
  assert.equal(
    (
      await request("/admin/candidates/" + id + "/edit", {
        candidate: edited,
        reason: "توضيح تفسير الحل قبل الاعتماد النهائي.",
        expectedRevision: candidate.revision,
      })
    ).status,
    200,
  );
  candidate = (await pool.query("SELECT * FROM candidates WHERE id=$1", [id]))
    .rows[0];
  assert.equal(
    (
      await request("/admin/candidates/" + id + "/review", {
        action: "approve",
        expectedRevision: candidate.revision,
        verificationNote:
          "راجعت صورة الإجابة ودليل الحل وترخيص الصورة الأصلية.",
        duplicateReviewed: true,
        difficulty: "medium",
        categoryIds: ["answer-media-test"],
      })
    ).status,
    200,
  );
  let question = (await pool.query("SELECT * FROM questions WHERE id=$1", [id]))
    .rows[0];
  assert.equal(question.answer_media_id, assetId);
  assert.equal(question.answer_media_alt, "صورة الإجابة الصحيحة");
  assert.equal(question.answer, input.answer);
  assert.equal(question.difficulty, "medium");
  const exported = await (await request("/admin/export")).json();
  assert.deepEqual(
    exported.find((row: any) => row.payload.text === input.text).payload
      .answerMedia,
    { assetId, alt: "صورة الإجابة الصحيحة" },
  );
  assert.equal(
    (
      await request("/admin/questions/" + id + "/edit", {
        text: "اختر الشكل المناسب لإكمال النمط الهندسي المعروض " + randomUUID(),
        answer: input.answer,
        aliases: [],
        explanation: input.explanation,
        hint: input.hint,
        categoryIds: input.categoryIds,
        reason: "تصحيح صياغة السؤال مع الحفاظ على الإجابة وصورتها.",
      })
    ).status,
    200,
  );
  question = (await pool.query("SELECT * FROM questions WHERE id=$1", [id]))
    .rows[0];
  assert.equal(question.answer_media_id, assetId);
  assert.equal(question.answer_media_alt, "صورة الإجابة الصحيحة");
  const imported = advanced(assetId);
  assert.equal((await request("/admin/import", [imported])).status, 200);
  assert.deepEqual(
    (await (await request("/admin/export")).json()).find(
      (row: any) => row.payload.factKey === imported.factKey,
    ).payload.answerMedia,
    imported.answerMedia,
  );
});

test("Missing and non-image answers fail ingestion, draft retries and approval revalidation", async () => {
  const assetId = await image(),
    missing = randomUUID();
  for (const invalid of [missing, assetId]) {
    if (invalid === assetId)
      await pool.query("UPDATE media_assets SET mime='audio/wav' WHERE id=$1", [
        assetId,
      ]);
    await assert.rejects(
      () => submitQuestion(draft(invalid), editorId),
      (e: any) => e.code === "ANSWER_MEDIA_INVALID",
    );
    await assert.rejects(
      () => ingest(advanced(invalid)),
      (e: any) => e.code === "ANSWER_MEDIA_INVALID",
    );
  }
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM candidates")).rows[0].n,
    0,
  );
  await pool.query("UPDATE media_assets SET mime='image/png' WHERE id=$1", [
    assetId,
  ]);
  const c = advanced(assetId),
    { id } = await ingest(c);
  await assert.rejects(
    () =>
      transaction((db) =>
        ingestWith(
          db,
          {
            ...c,
            answerMedia: { assetId: missing, alt: "صورة بديلة غير موجودة" },
          },
          id,
        ),
      ),
    (e: any) => e.code === "ANSWER_MEDIA_INVALID",
  );
  assert.deepEqual(
    (await pool.query("SELECT payload FROM candidates WHERE id=$1", [id]))
      .rows[0].payload.answerMedia,
    c.answerMedia,
  );
  await pool.query("UPDATE media_assets SET mime='video/mp4' WHERE id=$1", [
    assetId,
  ]);
  await assert.rejects(
    () =>
      transaction((db) =>
        publishCandidate(
          db,
          id,
          editorId,
          "راجعت الحل والصورة الأصلية وترخيصها.",
          true,
        ),
      ),
    (e: any) => e.code === "ANSWER_MEDIA_INVALID",
  );
  assert.equal(
    (await pool.query("SELECT status FROM candidates WHERE id=$1", [id]))
      .rows[0].status,
    "review",
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM questions")).rows[0].n,
    0,
  );
  const { answer: _answer, ...withoutAnswer } = draft(assetId);
  assert.equal(
    (await request("/admin/submissions", withoutAnswer)).status,
    400,
  );
});

test("Answer media and rights are hidden until reveal and stay private to the host and game instance", async () => {
  const stimulusId = await image(),
    answerBytes = Buffer.concat([png, Buffer.from("answer-fixture")]),
    answerId = await image(answerBytes);
  for (const difficulty of ["easy", "medium", "hard"]) {
    const c = advanced(answerId, {
      difficulty,
      format: "image",
      media: { assetId: stimulusId, alt: "رسم النمط الهندسي المطلوب إكماله" },
    });
    await transaction((db) => insertQuestion(db, c));
  }
  const setup = {
    categoryIds: ["answer-media-test"],
    teamNames: ["الأول", "الثاني"],
  };
  const first = await game.createGame(editorProfile, setup);
  const otherProfile = (await createSession()).profileId,
    second = await game.createGame(otherProfile, setup);
  const unopened = (await game.gameState(first.id, editorProfile)).tiles[0].id;
  const otherInstance = (await game.gameState(second.id, otherProfile)).tiles[0]
    .id;
  const path = "/games/" + first.id + "/answer-media/" + unopened;
  assert.equal((await request(path)).status, 404);
  const open = await game.openQuestion(first.id, editorProfile, unopened);
  for (const field of [
    "answer",
    "answer_media_id",
    "answer_media_alt",
    "answer_media_credit",
    "answer_media_license",
    "answer_media_source",
  ])
    assert.equal(open.current[field], null, field);
  assert.equal((await request(path)).status, 404);
  const stimulus = await request("/games/" + first.id + "/media/" + unopened);
  assert.equal(stimulus.status, 200);
  assert.deepEqual(Buffer.from(await stimulus.arrayBuffer()), png);
  assert.equal((await request("/media/" + answerId)).status, 404);
  const revealed = await game.reveal(first.id, editorProfile);
  assert.equal(revealed.current.answer_media_id, answerId);
  assert.equal(
    revealed.current.answer_media_alt,
    "المثلث الذهبي الذي يكمل النمط",
  );
  assert.equal(revealed.current.answer_media_credit, "رسام الإجابة للاختبار");
  assert.equal(revealed.current.answer_media_license, "عمل أصلي للاختبار فقط");
  assert.equal(
    revealed.current.answer_media_source,
    "https://example.com/answer",
  );
  const full = await request(path);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("cache-control"), "no-store");
  assert.equal(full.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), answerBytes);
  assert.equal((await request(path, undefined, guestCookie)).status, 404);
  assert.equal(
    (await request("/games/" + first.id + "/answer-media/" + otherInstance))
      .status,
    404,
  );
  const ranged = await fetch(origin + "/api" + path, {
    headers: { cookie: editorCookie, range: "bytes=2-8" },
  });
  assert.equal(ranged.status, 206);
  assert.equal(
    ranged.headers.get("content-range"),
    `bytes 2-8/${answerBytes.length}`,
  );
  assert.deepEqual(
    Buffer.from(await ranged.arrayBuffer()),
    answerBytes.subarray(2, 9),
  );
  await game.score(first.id, editorProfile, {
    instanceId: unopened,
    outcome: "skipped",
  });
  assert.equal((await request(path)).status, 200);
  await pool.query("UPDATE media_blobs SET bytes=$2 WHERE asset_id=$1", [
    answerId,
    Buffer.alloc(answerBytes.length),
  ]);
  assert.equal((await request(path)).status, 500);
  assert.equal(
    (
      await pool.query("SELECT sha256 FROM media_assets WHERE id=$1", [
        answerId,
      ])
    ).rows[0].sha256,
    createHash("sha256").update(answerBytes).digest("hex"),
  );
});
