import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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
    "Authorship tests require an explicit isolated TEST_DATABASE_URL for external databases.",
  );
if (process.env.TEST_DATABASE_URL && !isolated.pathname.endsWith("_test"))
  throw new Error("Integration database name must end in _test.");
const databaseName = "authorship_" + randomUUID().replaceAll("-", "") + "_test";
isolated.pathname = "/" + databaseName;
process.env.DATABASE_URL = isolated.href;
const { pool, transaction, AppError } = await import("../server/db.ts");
const { tokenHash, hashPassword } = await import("../server/auth.ts");
const { candidateSchema, ingest, ingestWith } =
  await import("../server/content.ts");
const { validateModelCandidates, runJob } = await import("../server/worker.ts");
const game = await import("../server/game.ts");
const { api } = await import("../server/api.ts");
let server: Server | undefined,
  origin = "",
  createdDatabase = false;
let author: Awaited<ReturnType<typeof session>>,
  reviewer: Awaited<ReturnType<typeof session>>;
const password = "private isolated authorship fixture password";

async function session() {
  const profileId = randomUUID(),
    id = randomUUID(),
    username = "author_" + id.slice(0, 8),
    token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO profiles(id,kind) VALUES($1,'account')", [
    profileId,
  ]);
  await pool.query(
    "INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,$4,'editor')",
    [id, profileId, username, hashPassword(password)],
  );
  await pool.query(
    "INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(token), profileId],
  );
  return { id, profileId, username, cookie: "nabeeh_session=" + token };
}
async function request(
  path: string,
  body?: unknown,
  cookie = author.cookie,
  method?: string,
) {
  return fetch(origin + "/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function draft(difficulty = "easy") {
  const key = randomUUID();
  return {
    text: "ما الإجابة المناسبة لهذا السؤال التجريبي " + key,
    answer: "إجابة " + key,
    explanation:
      "هذا شرح الإجابة الذي يساعد على فهم السؤال وتحليل فكرته " + key,
    hint: "اقرأ السؤال بعناية.",
    categoryIds: ["authorship-test"],
    difficulty,
    format: "text",
    tags: ["سؤال بشري"],
  };
}
function advanced() {
  const d = draft(),
    key = randomUUID();
  return candidateSchema.parse({
    ...d,
    factKey: "authorship:" + key,
    subject: key,
    predicate: "answer",
    fact: d.explanation,
    provenance: "Model proposal; evidence unverified; manual review required.",
  });
}
async function approve(id: string) {
  const {
    rows: [row],
  } = await pool.query("SELECT revision FROM candidates WHERE id=$1", [id]);
  return request(
    "/admin/candidates/" + id + "/review",
    {
      action: "approve",
      expectedRevision: row.revision,
      duplicateReviewed: true,
      verificationNote:
        "راجعت الإجابة والتفسير والتصنيف وتأكدت من وضوح السؤال.",
    },
    reviewer.cookie,
  );
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
  author = await session();
  reviewer = await session();
  await pool.query(
    "INSERT INTO categories(id,name,description,icon,color) VALUES('authorship-test','تأليف للاختبار','فئة معزولة للاختبار','◯','#eee')",
  );
  const app = express();
  app.use(express.json());
  app.use("/api", api);
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
  await pool.query(
    "TRUNCATE games,questions,candidates,generation_jobs CASCADE",
  );
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

test("Source-free admin questions require review, keep their author, and expose no creator identity to players", async () => {
  const ids: string[] = [];
  for (const difficulty of ["easy", "medium", "hard"]) {
    const input = draft(difficulty),
      response = await request("/admin/submissions", input);
    assert.equal(response.status, 201);
    const { id, status } = await response.json();
    ids.push(id);
    assert.equal(status, "review");
    let row = (await pool.query("SELECT * FROM candidates WHERE id=$1", [id]))
      .rows[0];
    assert.equal(row.creation_kind, "admin");
    assert.equal(row.created_by, author.id);
    assert.deepEqual(row.payload.sources, []);
    assert.equal(row.payload.fact, input.explanation);
    assert.equal(row.payload.evidenceKind, "factual");
    assert.doesNotMatch(row.payload.provenance, /copyright|owned|original/i);
    assert.equal(
      (await pool.query("SELECT 1 FROM questions WHERE id=$1", [id])).rowCount,
      0,
    );
    const queue = await (await request("/admin/review-queue")).json();
    assert.equal(
      queue.items.find((c: any) => c.id === id).creator_username,
      author.username,
    );
    assert.equal((await approve(id)).status, 200);
    row = (await pool.query("SELECT * FROM questions WHERE id=$1", [id]))
      .rows[0];
    assert.equal(row.created_by, author.id);
    assert.equal(row.reviewed_by, reviewer.id);
    assert.equal(row.creation_kind, "admin");
    assert.ok(row.verified_at);
    assert.equal(
      (
        await pool.query(
          "SELECT verification_method FROM evidence WHERE question_id=$1",
          [id],
        )
      ).rows[0].verification_method,
      "editorial-admin",
    );
    assert.equal(
      (await (await request("/admin/review-queue")).json()).items.some(
        (c: any) => c.id === id,
      ),
      false,
    );
  }
  const library = await (await request("/admin/questions")).json();
  assert.equal(
    library.find((q: any) => q.id === ids[0]).creator_username,
    author.username,
  );
  const exported = await (await request("/admin/export")).json();
  assert.equal(exported.length, 3);
  assert.equal(exported[0].creation_kind, "admin");
  assert.equal(exported[0].creator_username, author.username);
  assert.equal(exported[0].payload.creation_kind, undefined);
  const { id } = await game.createGame(author.profileId, {
    categoryIds: ["authorship-test"],
    teamNames: ["الأول", "الثاني"],
  });
  const tile = (await game.gameState(id, author.profileId)).tiles[0].id;
  const opened = await game.openQuestion(id, author.profileId, tile);
  assert.equal(opened.current.creation_kind, "admin");
  assert.equal(opened.current.answer, null);
  assert.equal(opened.current.creator_username, undefined);
  assert.equal(opened.current.created_by, undefined);
  assert.equal(JSON.stringify(opened.current).includes(author.username), false);
});

test("Trusted AI and generator origins survive admin edits while spoofed authorship and model answer images fail", async () => {
  const c = advanced(),
    { id } = await ingest(c, { kind: "ai" });
  assert.equal((await approve(id)).status, 400);
  const amended = {
    ...c,
    hint: "تلميح جديد راجعه المحرر.",
    sources: [
      {
        url: "https://example.com/evidence",
        citation: "مرجع تجريبي خاص بهذا الاختبار فقط",
      },
    ],
  };
  const edited = await request(
    "/admin/candidates/" + id + "/edit",
    {
      candidate: amended,
      expectedRevision: 1,
      reason: "راجع المحرر الصياغة وأرفق دليلاً للمراجعة.",
    },
    reviewer.cookie,
  );
  assert.equal(edited.status, 200);
  // Even a trusted manual context on a retry cannot rewrite stored creation metadata.
  await transaction((db) =>
    ingestWith(db, candidateSchema.parse(amended), id, {
      kind: "admin",
      createdBy: reviewer.id,
    }),
  );
  assert.equal((await approve(id)).status, 200);
  const q = (
    await pool.query(
      "SELECT creation_kind,created_by FROM questions WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(q.creation_kind, "ai");
  assert.equal(q.created_by, null);
  for (const field of [
    "creation_kind",
    "created_by",
    "creator_username",
    "creationKind",
    "createdBy",
  ]) {
    assert.equal(
      (await request("/admin/submissions", { ...draft(), [field]: "admin" }))
        .status,
      400,
    );
    assert.equal(
      (await request("/admin/candidates", { ...advanced(), [field]: "admin" }))
        .status,
      400,
    );
  }
  const target = {
    categoryId: "authorship-test",
    difficulty: "easy",
    format: "text",
    region: "all",
  };
  assert.throws(() =>
    validateModelCandidates(
      { questions: [{ ...c, creation_kind: "admin" }] },
      1,
      target,
    ),
  );
  assert.throws(() =>
    validateModelCandidates(
      {
        questions: [
          { ...c, answerMedia: { assetId: randomUUID(), alt: "صورة إجابة" } },
        ],
      },
      1,
      target,
    ),
  );
  await pool.query(
    "INSERT INTO categories(id,name,description,icon,color) VALUES('logic','ألغاز','ألغاز للاختبار','◯','#eee') ON CONFLICT DO NOTHING",
  );
  const jobId = randomUUID();
  await pool.query(
    "INSERT INTO generation_jobs(id,category_id,kind,count) VALUES($1,'logic','arithmetic',1)",
    [jobId],
  );
  assert.equal(await runJob(), true);
  const generated = (
    await pool.query(
      "SELECT creation_kind,created_by FROM candidates WHERE payload->>'deterministic'='true'",
    )
  ).rows;
  assert.equal(generated.length, 1);
  assert.equal(generated[0].creation_kind, "generator");
  assert.equal(generated[0].created_by, null);
});

test("Authorship migration uses manual submission audits and does not mistake reviewers or editable provenance for authors", async () => {
  const sql = await readFile(
    new URL("../migrations/020_question_authorship.sql", import.meta.url),
    "utf8",
  );
  await transaction(async (db) => {
    const schema = "authorship_migration_" + randomUUID().replaceAll("-", "");
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    await db.query(
      "CREATE TABLE users(id uuid PRIMARY KEY); CREATE TABLE candidates(id uuid PRIMARY KEY,payload jsonb); CREATE TABLE questions(id uuid PRIMARY KEY,reviewed_by uuid); CREATE TABLE audit_logs(id bigserial,actor_id uuid,action text,target text,created_at timestamptz DEFAULT now()); CREATE TABLE evidence(url text,verification_method text,CONSTRAINT evidence_check CHECK(url IS NOT NULL OR verification_method='deterministic'))",
    );
    const user = randomUUID(),
      manual = randomUUID(),
      fake = randomUUID(),
      deleted = randomUUID();
    await db.query("INSERT INTO users VALUES($1)", [user]);
    for (const id of [manual, fake, deleted]) {
      await db.query("INSERT INTO candidates VALUES($1,$2)", [
        id,
        {
          provenance:
            "Model proposal; evidence unverified; manual review required.",
        },
      ]);
      await db.query("INSERT INTO questions VALUES($1,$2)", [id, user]);
    }
    await db.query(
      "INSERT INTO audit_logs(actor_id,action,target) VALUES($1,'submit-question',$2),(NULL,'submit-question',$3),($1,'approve-question',$4)",
      [user, manual, deleted, fake],
    );
    await db.query(sql);
    const rows = new Map(
      (await db.query("SELECT * FROM questions")).rows.map((row) => [
        row.id,
        row,
      ]),
    );
    assert.equal(rows.get(manual).creation_kind, "admin");
    assert.equal(rows.get(manual).created_by, user);
    assert.equal(rows.get(deleted).creation_kind, "admin");
    assert.equal(rows.get(deleted).created_by, null);
    assert.equal(rows.get(fake).creation_kind, "unknown");
    assert.equal(rows.get(fake).created_by, null);
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
  });
});

test("Deleting an author anonymizes attribution while preserving approved question origin", async () => {
  const temporary = await session(),
    response = await request("/admin/submissions", draft(), temporary.cookie);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await approve(id)).status, 200);
  assert.equal(
    (
      await request(
        "/account",
        { confirm: "DELETE", password },
        temporary.cookie,
        "DELETE",
      )
    ).status,
    200,
  );
  const q = (
    await pool.query(
      "SELECT creation_kind,created_by FROM questions WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(q.creation_kind, "admin");
  assert.equal(q.created_by, null);
  const exported = await (await request("/admin/export")).json();
  assert.equal(exported[0].creation_kind, "admin");
  assert.equal(exported[0].creator_username, null);
  assert.equal(JSON.stringify(exported).includes(temporary.username), false);
});
