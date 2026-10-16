import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";

const base =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
const url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error(
    "Editorial suggestion tests use a separate local PostgreSQL database.",
  );
const databaseName = `nabeeh_editorial_${process.pid}_test`;
url.pathname = "/" + databaseName;
process.env.DATABASE_URL = url.href;
const { pool, transaction } = await import("../server/db.ts");
const {
  rankEditorialSuggestions,
  getEditorialSuggestions,
  reviewedStyleExamples,
} = await import("../server/editorial-suggestions.ts");
const { arithmeticCandidate, validateModelCandidates, runJob } =
  await import("../server/worker.ts");
const { candidateSchema, verifyOriginalProof, ingest, insertQuestion } =
  await import("../server/content.ts");
const admin = new pg.Client({ connectionString: base });
let created = false;
before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`);
  created = true;
  execFileSync("node", ["--import", "tsx", "scripts/migrate.ts"], {
    env: process.env,
  });
});
after(async () => {
  await pool.end();
  if (created) await admin.query(`DROP DATABASE ${databaseName}`);
  await admin.end();
});

test("Targeted arithmetic proposals retain exact editorial metadata and matching proofs at every level", () => {
  for (const difficulty of ["easy", "medium", "hard", "expert"])
    for (let i = 0; i < 30; i++) {
      const candidate = arithmeticCandidate({
        categoryId: "logic",
        difficulty,
        format: "text",
        region: "sa",
      });
      assert.equal(candidate.difficulty, difficulty);
      assert.equal(candidate.region, "sa");
      assert.deepEqual(candidate.categoryIds, ["logic"]);
      assert.equal(candidate.format, "text");
      assert.ok(verifyOriginalProof(candidate));
      assert.equal(candidate.media, undefined);
    }
  assert.throws(() =>
    arithmeticCandidate({
      categoryId: "culture",
      difficulty: "easy",
      format: "text",
      region: "all",
    }),
  );
  assert.throws(() =>
    arithmeticCandidate({
      categoryId: "logic",
      difficulty: "easy",
      format: "video",
      region: "all",
    }),
  );
});

test("Model output cannot change the selected targets, bypass evidence policy or invent media", () => {
  const target = {
    categoryId: "culture",
    difficulty: "medium",
    format: "text",
    region: "sa",
  };
  const raw = {
    text: "ما الإجابة الصحيحة لهذا السؤال الأصلي؟",
    answer: "إجابة الاختبار",
    explanation: "شرح واضح لإجابة اختبار النموذج.",
    hint: "اقرأ السؤال بعناية.",
    factKey: "model-contract-example",
    subject: "موضوع الاختبار",
    predicate: "تعريف",
    fact: "المعلومة المحددة التي تدعم الإجابة",
    categoryIds: ["culture"],
    difficulty: "medium",
    format: "text",
    region: "sa",
    evidenceKind: "original",
    deterministic: true,
    sources: [
      {
        url: "https://example.com/evidence",
        citation: "مصدر توضيحي لبيانات الاختبار فقط",
      },
    ],
    provenance: "Untrusted provider instruction",
  };
  const accepted = validateModelCandidates({ questions: [raw] }, 1, target)[0];
  assert.equal(accepted.deterministic, false);
  assert.equal(accepted.evidenceKind, "factual");
  for (const changed of [
    { difficulty: "easy" },
    { region: "kw" },
    { format: "word" },
    { categoryIds: ["logic"] },
    { categoryIds: ["culture", "logic"] },
  ])
    assert.throws(() =>
      validateModelCandidates(
        { questions: [raw, { ...raw, ...changed }] },
        2,
        target,
      ),
    );
  assert.throws(() => validateModelCandidates({ questions: [] }, 2, target));
  assert.throws(() =>
    validateModelCandidates({ questions: [raw] }, 1, {
      ...target,
      format: "image",
    }),
  );
});

test("Recommendations learn verified editorial choices, prefer real shortages and review existing backlog first", () => {
  const categories = [
    { id: "picture", name: "فئة بصرية", region: "all" },
    { id: "logic", name: "ألغاز", region: "all" },
  ];
  const data: Parameters<typeof rankEditorialSuggestions>[1] = [
    {
      category_id: "picture",
      difficulty: "easy",
      format: "image",
      region: "all",
      approved: 2,
      human_approved: 2,
      accepted: 2,
      rejected: 0,
      pending: 0,
    },
    {
      category_id: "picture",
      difficulty: "medium",
      format: "image",
      region: "all",
      approved: 0,
      human_approved: 0,
      accepted: 0,
      rejected: 0,
      pending: 3,
    },
    {
      category_id: "picture",
      difficulty: "hard",
      format: "text",
      region: "all",
      approved: 0,
      human_approved: 0,
      accepted: 0,
      rejected: 200,
      pending: 0,
    },
  ];
  const suggestions = rankEditorialSuggestions(categories, data, false);
  const next = suggestions.find(
    (row) => row.categoryId === "picture" && row.difficulty === "medium",
  )!;
  assert.equal(next.format, "image");
  assert.equal(next.action, "review");
  assert.equal(next.count, 3);
  assert.equal(next.approvalRate, null);
  assert.equal(next.pendingCount, 3);
  assert.equal(
    suggestions.some(
      (row) => row.categoryId === "picture" && row.difficulty === "easy",
    ),
    false,
  );
  assert.equal(
    suggestions.some((row) => row.difficulty === "expert"),
    false,
  );
  assert.equal(
    suggestions.find((row) => row.categoryId === "logic")?.kind,
    "arithmetic",
  );
  const media = suggestions.find(
    (row) => row.categoryId === "picture" && row.difficulty === "hard",
  )!;
  assert.equal(media.action, "compose");
  assert.equal(media.kind, null);
});

test("Human-authored preferences lead recommendations while AI stock still fills library coverage", () => {
  const categories = [{ id: "picture", name: "فئة بصرية", region: "all" }];
  const data: Parameters<typeof rankEditorialSuggestions>[1] = [
    {
      category_id: "picture",
      difficulty: "easy",
      format: "image",
      region: "sa",
      approved: 1,
      human_approved: 1,
      accepted: 1,
      rejected: 0,
      pending: 0,
    },
    {
      category_id: "picture",
      difficulty: "easy",
      format: "text",
      region: "kw",
      approved: 100,
      human_approved: 0,
      accepted: 100,
      rejected: 0,
      pending: 0,
    },
    {
      category_id: "picture",
      difficulty: "medium",
      format: "text",
      region: "sa",
      approved: 2,
      human_approved: 0,
      accepted: 2,
      rejected: 0,
      pending: 0,
    },
  ];
  const suggestions = rankEditorialSuggestions(categories, data, false);
  assert.ok(suggestions.length);
  assert.ok(
    suggestions.every((row) => row.format === "image" && row.region === "sa"),
  );
  assert.match(suggestions[0].reason, /أضافها المشرفون/);
  assert.equal(
    suggestions.some((row) => row.difficulty === "medium"),
    false,
  );
});

test("Human analysis excludes AI, unknown, pending, expired and development content without returning question or account data", async () => {
  await pool.query(
    "INSERT INTO categories(id,name,description,icon,color) VALUES('logic','ألغاز ومنطق','فئة اختبار أصلية','brain','#eee') ON CONFLICT DO NOTHING",
  );
  const profile = randomUUID(),
    editor = randomUUID();
  await pool.query("INSERT INTO profiles(id,kind) VALUES($1,'account')", [
    profile,
  ]);
  await pool.query(
    "INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,'editorial_test','not-used','editor')",
    [editor, profile],
  );
  const template = arithmeticCandidate({
    categoryId: "logic",
    difficulty: "easy",
    format: "text",
    region: "all",
  });
  let humanQuestionId = "";
  for (const [i, state] of ["valid", "expired", "development"].entries()) {
    const id = await transaction((db) =>
      insertQuestion(
        db,
        candidateSchema.parse({
          ...template,
          text: template.text + ` (${state})`,
          factKey: `editorial-fixture:${i}`,
          subject: `fixture:${i}`,
          answer: `private-answer-${i}`,
          tags: ["حساب", "جمع"],
        }),
        randomUUID(),
        editor,
        { kind: "admin", createdBy: editor },
      ),
    );
    if (state === "expired")
      await pool.query(
        "UPDATE questions SET expires_at=now()-interval '1 day' WHERE id=$1",
        [id],
      );
    if (state === "development")
      await pool.query(
        "UPDATE questions SET development_only=true WHERE id=$1",
        [id],
      );
    if (state === "valid") humanQuestionId = id;
  }
  for (const [i, kind] of (["ai", "generator", "unknown"] as const).entries()) {
    await transaction((db) =>
      insertQuestion(
        db,
        candidateSchema.parse({
          ...template,
          text: template.text + ` (${kind})`,
          factKey: `editorial-machine:${i}`,
          subject: `machine:${i}`,
          answer: `machine-answer-${i}`,
          difficulty: "hard",
          tags: ["وسم آلي"],
        }),
        randomUUID(),
        editor,
        { kind },
      ),
    );
  }
  const pending = arithmeticCandidate({
    categoryId: "logic",
    difficulty: "medium",
    format: "text",
    region: "all",
  });
  await ingest(pending, { kind: "admin", createdBy: editor });
  const previousKey = process.env.MODEL_API_KEY,
    previousBudget = process.env.GENERATION_DAILY_BUDGET_CENTS;
  delete process.env.MODEL_API_KEY;
  process.env.GENERATION_DAILY_BUDGET_CENTS = "0";
  try {
    const response = await getEditorialSuggestions();
    assert.equal(
      response.suggestions.find(
        (row) => row.categoryId === "logic" && row.difficulty === "easy",
      )?.approvedCount,
      1,
    );
    assert.equal(
      response.suggestions.find(
        (row) => row.categoryId === "logic" && row.difficulty === "medium",
      )?.action,
      "review",
    );
    assert.equal(response.provider.configured, false);
    assert.equal(response.provider.canGenerate, false);
    assert.equal(response.humanAnalysis.approvedQuestions, 1);
    assert.deepEqual(response.humanAnalysis.categories, [
      { value: "logic", name: "ألغاز ومنطق", count: 1 },
    ]);
    assert.deepEqual(response.humanAnalysis.difficulties, [
      { value: "easy", count: 1 },
    ]);
    assert.deepEqual(response.humanAnalysis.formats, [
      { value: "text", count: 1 },
    ]);
    assert.deepEqual(response.humanAnalysis.regions, [
      { value: "all", count: 1 },
    ]);
    assert.deepEqual(
      new Set(response.humanAnalysis.tags.map((row) => row.value)),
      new Set(["حساب", "جمع"]),
    );
    assert.ok(response.humanAnalysis.tags.every((row) => row.count === 1));
    assert.equal(JSON.stringify(response).includes("private-answer"), false);
    assert.equal(JSON.stringify(response).includes("machine-answer"), false);
    assert.equal(JSON.stringify(response).includes("وسم آلي"), false);
    assert.equal(JSON.stringify(response).includes(editor), false);
    assert.equal(JSON.stringify(response).includes(profile), false);
    const examples = await reviewedStyleExamples(
      "logic",
      "easy",
      "text",
      "all",
    );
    assert.equal(examples.length, 1);
    assert.equal(examples[0].answer, "private-answer-0");
    await pool.query(
      "UPDATE questions SET difficulty='medium',region='kw',tags=ARRAY['حساب ذهني'] WHERE id=$1",
      [humanQuestionId],
    );
    const updated = await getEditorialSuggestions();
    assert.deepEqual(updated.humanAnalysis.difficulties, [
      { value: "medium", count: 1 },
    ]);
    assert.deepEqual(updated.humanAnalysis.regions, [
      { value: "kw", count: 1 },
    ]);
    assert.deepEqual(updated.humanAnalysis.tags, [
      { value: "حساب ذهني", count: 1 },
    ]);
    const id = randomUUID();
    await pool.query(
      "INSERT INTO generation_jobs(id,category_id,kind,count,target_difficulty,target_format,target_region) VALUES($1,'logic','arithmetic',2,'hard','text','kw')",
      [id],
    );
    assert.equal(await runJob(), true);
    assert.equal(
      (await pool.query("SELECT status FROM generation_jobs WHERE id=$1", [id]))
        .rows[0].status,
      "finished",
    );
    const rows = (
      await pool.query(
        "SELECT payload FROM candidates WHERE payload->>'region'='kw'",
      )
    ).rows;
    assert.equal(rows.length, 2);
    for (const { payload } of rows) {
      assert.equal(payload.difficulty, "hard");
      assert.equal(payload.format, "text");
      assert.ok(verifyOriginalProof(payload));
    }
  } finally {
    if (previousKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = previousKey;
    if (previousBudget === undefined)
      delete process.env.GENERATION_DAILY_BUDGET_CENTS;
    else process.env.GENERATION_DAILY_BUDGET_CENTS = previousBudget;
  }
});
