import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { readFile } from "node:fs/promises";
const base =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
const url = new URL(base);
if (!process.env.TEST_DATABASE_URL && !["localhost","127.0.0.1"].includes(url.hostname)) throw new Error("External integration tests require an explicit isolated TEST_DATABASE_URL ending in _test.");
if (process.env.TEST_DATABASE_URL && !url.pathname.endsWith("_test")) throw new Error("Integration database name must end in _test.");
if (!process.env.TEST_DATABASE_URL) url.pathname = "/nabeeh_test";
process.env.DATABASE_URL = url.href;
const { pool, transaction } = await import("../server/db.ts");
const game = await import("../server/game.ts");
const {
  normalizeArabic,
  digest,
  ingest,
  insertQuestion,
  publishCandidate,
  candidateSchema,
  verifyArithmetic,
  verifyCanonical,
  verifyOriginalProof,
} = await import("../server/content.ts");
const { mergeProfiles, tokenHash, hashPassword, checkPassword, updateRole } =
  await import("../server/auth.ts");
const { runJob } = await import("../server/worker.ts");
const { factSignature, cosine } = await import("../server/semantic.ts");
before(async () => {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  if (
    !(
      await admin.query("SELECT 1 FROM pg_database WHERE datname='nabeeh_test'")
    ).rowCount
  )
    await admin.query("CREATE DATABASE nabeeh_test");
  await admin.end();
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  execFileSync("node", ["--import", "tsx", "scripts/migrate.ts"], {
    env: process.env,
  });
  execFileSync("node", ["--import", "tsx", "scripts/seed.ts"], {
    env: process.env,
  });
});

test("Recovery keys are single-use, expire, revoke sessions and retain game/exposure history", async()=>{
  const {issueRecoveryKey,recoverAccount} = await import("../server/recovery.ts");
  const p=await profile("account"),userId=randomUUID(),username="recover_"+userId.slice(0,8);
  await pool.query("INSERT INTO users(id,profile_id,username,password_hash) VALUES($1,$2,$3,$4)",[userId,p,username,hashPassword("old recovery password")]);
  const {id}=await game.createGame(p,setup());await play(p,id);
  const key=await transaction(db=>issueRecoveryKey(db,userId));
  await pool.query("INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[tokenHash("recovery-fixture"),p]);
  const attempts=await Promise.allSettled([recoverAccount(username,key,"new secure password"),recoverAccount(username,key,"new secure password")]);
  assert.equal(attempts.filter(a=>a.status==="fulfilled").length,1);
  assert.equal((await pool.query("SELECT 1 FROM sessions WHERE profile_id=$1",[p])).rowCount,0);
  assert.equal((await pool.query("SELECT 1 FROM exposures WHERE profile_id=$1",[p])).rowCount,1);
  assert.equal((await game.gameState(id,p)).status,"active");
  assert.ok(checkPassword("new secure password",(await pool.query("SELECT password_hash FROM users WHERE id=$1",[userId])).rows[0].password_hash));
  const next=await transaction(db=>issueRecoveryKey(db,userId));
  await pool.query("UPDATE recovery_keys SET expires_at=now()-interval '1 second' WHERE user_id=$1",[userId]);
  await assert.rejects(()=>recoverAccount(username,next,"another secure password"),(e:any)=>e.code==="RECOVERY_INVALID");
});

test("Ordering responses survive resume, reject invalid permutations, and hide the solution until reveal",async()=>{
  await pool.query("INSERT INTO categories(id,name,description,icon,color) VALUES('ordering-test','ترتيب للاختبار','ترتيب محفوظ','↕','#eee')");
  for(const [i,values] of [[13,5,9],[26,7,18],[54,22,31]].entries()) {
    const ordered=values.map(String).sort((a,b)=>Number(a)-Number(b));
    await transaction(db=>insertQuestion(db,candidateSchema.parse({text:"رتّب الأعداد التالية تصاعديًا: "+values.join("، "),answer:ordered.join("، "),explanation:"الترتيب من الأصغر إلى الأكبر.",hint:"قارن القيم.",factKey:"ordering-test:"+i,subject:values.join(","),predicate:"ascending",fact:"ascending:"+values.join(",")+"="+ordered.join(","),format:"ordering",options:values.map(String),orderingAnswer:ordered,categoryIds:["ordering-test"],difficulty:["easy","medium","hard"][i],deterministic:true,provenance:"Isolated integration fixture"})));
  }
  const p=await profile(),other=await profile(),{id}=await game.createGame(p,setup(["ordering-test"]));
  await play(p,id);const before=await game.gameState(id,p);
  assert.equal(before.current.ordering_answer,null);assert.equal(before.current.answer,null);
  const items=[...before.current.options].reverse();
  await game.respond(id,p,{items});
  assert.deepEqual((await game.gameState(id,p)).current.response,{items});
  await assert.rejects(()=>game.respond(id,p,{items:[items[0],items[0],items[0]]}),(e:any)=>e.code==="RESPONSE_INVALID");
  await assert.rejects(()=>game.respond(id,other,{items}),(e:any)=>e.code==="GAME_NOT_FOUND");
  await game.reveal(id,p);assert.ok((await game.gameState(id,p)).current.ordering_answer);
  await assert.rejects(()=>game.respond(id,p,{items}),(e:any)=>e.code==="RESPONSE_CLOSED");
});

test("Every original release draft has valid structure and a matching deterministic proof",async()=>{
  const pack=JSON.parse(await readFile("media/release-pack.json","utf8"));
  assert.equal(pack.questions.length,36);
  const keys=new Set();
  for(const raw of pack.questions) {
    const q=candidateSchema.parse(raw);assert.ok(verifyOriginalProof(q),q.factKey);
    assert.equal(keys.has(q.factKey),false);keys.add(q.factKey);
  }
  const media=candidateSchema.parse(pack.questions.find((q:any)=>q.format==="image"));
  assert.equal(candidateSchema.safeParse({...media,media:undefined}).success,false);
  assert.equal(verifyOriginalProof({...media,answer:"999"}),false);
  const wrong=candidateSchema.parse({...pack.questions[35],factKey:"invalid-proof:test",answer:"999"});
  const candidate=await ingest(wrong);
  const actor=randomUUID(),actorProfile=await profile("account");
  await pool.query("INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,$4,'editor')",[actor,actorProfile,"proof_"+actor.slice(0,8),hashPassword("proof test password")]);
  await assert.rejects(()=>transaction(db=>publishCandidate(db,candidate.id,actor,"Test rejects a proof that disagrees with the answer.",true)),(e:any)=>e.code==="EVIDENCE_REQUIRED");
});
test("Starter difficulty corrections preserve approved and edited drafts and invalidate stale reviews",async()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  await transaction(async db=>{
    const fixtures=[
      [ids[0],"release-v1:logic:original-calculation:48*29","easy","review",1],
      [ids[1],"release-v1:logic:original-calculation:19+26","medium","review",2],
      [ids[2],"release-v1:logic:original-calculation:53+27","hard","approved",1],
    ];
    for(const [id,factKey,difficulty,status,revision] of fixtures) await db.query("INSERT INTO candidates(id,fact_key,normalized_hash,payload,status,revision) VALUES($1,$2,$6,$3,$4,$5)",[id,factKey,JSON.stringify({difficulty}),status,revision,String(id)]);
    await db.query(await readFile(new URL("../migrations/014_release_draft_difficulty.sql",import.meta.url),"utf8"));
    const result=await db.query("SELECT id,payload->>'difficulty' AS difficulty,revision FROM candidates WHERE id=ANY($1::uuid[])",[ids]);
    const rows=new Map(result.rows.map(row=>[row.id,row]));
    assert.equal(rows.get(ids[0]).difficulty,"hard");assert.equal(rows.get(ids[0]).revision,2);
    assert.equal(rows.get(ids[1]).difficulty,"medium");assert.equal(rows.get(ids[1]).revision,2);
    assert.equal(rows.get(ids[2]).difficulty,"hard");assert.equal(rows.get(ids[2]).revision,1);
    assert.equal((await db.query("SELECT 1 FROM audit_logs WHERE target=ANY($1::text[]) AND action='correct-release-draft-difficulty'",[ids])).rowCount,1);
    await db.query("DELETE FROM audit_logs WHERE target=ANY($1::text[])",[ids]);
    await db.query("DELETE FROM candidates WHERE id=ANY($1::uuid[])",[ids]);
  });
});
after(async () => {
  await pool.end();
});
async function profile(kind = "guest") {
  const id = randomUUID();
  await pool.query("INSERT INTO profiles(id,kind) VALUES($1,$2)", [id, kind]);
  return id;
}
const setup = (categoryIds = ["logic"]) => ({
  categoryIds,
  teamNames: ["الصقور", "النمور"],
  timer: 180,
  questionsPerCategory: 3,
});
async function play(host: string, id: string) {
  const state = await game.gameState(id, host);
  const tile = state.tiles.find((x) => x.status === "available")!;
  await game.openQuestion(id, host, tile.id);
  return tile;
}
test("Arabic normalization preserves meaning and deterministic aliases", () => {
  assert.equal(
    normalizeArabic("مَا عَاصِمَةُ أُستراليا؟ ١٢"),
    normalizeArabic("ما عاصمة استراليا 12"),
  );
  assert.notEqual(normalizeArabic("مدرسة"), normalizeArabic("مدرسه"));
  assert.notEqual(normalizeArabic("سؤال"), normalizeArabic("سوال"));
  assert.equal(normalizeArabic("على"), normalizeArabic("علي"));
  assert.equal(
    checkPassword("long secure password", hashPassword("long secure password")),
    true,
  );
});
test("Exposure occurs at display, survives resume, and never occurs just at reservation", async () => {
  const p = await profile(),
    { id } = await game.createGame(p, setup());
  assert.equal(
    (await pool.query("SELECT * FROM exposures WHERE profile_id=$1", [p]))
      .rowCount,
    0,
  );
  const t = await play(p, id);
  assert.equal(
    (await pool.query("SELECT * FROM exposures WHERE profile_id=$1", [p]))
      .rowCount,
    1,
  );
  const state = await game.gameState(id, p);
  assert.equal(state.current?.id, t.id);
  assert.equal(state.current?.answer, null);
  assert.equal(state.current?.accepted_answers,null);
  await game.openQuestion(id, p, t.id);
  assert.equal(
    (await pool.query("SELECT * FROM exposures WHERE profile_id=$1", [p]))
      .rowCount,
    1,
  );
  await game.abandon(id, p);
  assert.equal(
    (await pool.query("SELECT * FROM exposures WHERE profile_id=$1", [p]))
      .rowCount,
    1,
  );
});
test("Canonical exclusion crosses categories, variants and new games; exhaustion never recycles", async () => {
  const p = await profile();
  await pool.query(
    "INSERT INTO categories VALUES('isolated',null,'فئة الاختبار','فئة لتأكيد الهوية','◇','#eee','all','{}')",
  );
  const { id } = await game.createGame(p, setup());
  const t = await play(p, id);
  const {
    rows: [q],
  } = await pool.query(
    "SELECT q.* FROM questions q JOIN game_questions i ON i.question_id=q.id WHERE i.id=$1",
    [t.id],
  );
  await pool.query("INSERT INTO question_categories VALUES($1,$2)", [
    q.id,
    "isolated",
  ]);
  await pool.query("INSERT INTO question_variants VALUES($1,$2,$3,$4,$5)", [
    randomUUID(),
    q.id,
    "ar",
    "صياغة بديلة لحقيقة السؤال",
    digest("صياغة بديلة لحقيقة السؤال"),
  ]);
  await game.abandon(id, p);
  await assert.rejects(
    () =>
      game.createGame(p, { ...setup(["isolated"]), difficulty: q.difficulty }),
    (e: any) => e.code === "FRESH_POOL_EXHAUSTED",
  );
});
test("Concurrent board requests reserve distinct canonical questions for the same profile", async () => {
  const p = await profile();
  const boards = await Promise.all([
    game.createGame(p, setup()),
    game.createGame(p, setup()),
  ]);
  const { rows } = await pool.query(
    "SELECT question_id FROM game_questions WHERE game_id=ANY($1::uuid[])",
    [boards.map((x) => x.id)],
  );
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map((x) => x.question_id)).size, 6);
  await assert.rejects(
    () => game.createGame(p, setup()),
    (e: any) => e.code === "FRESH_POOL_EXHAUSTED",
  );
});
test("Scoring is idempotent under concurrent retries and interrupted games", async () => {
  const p = await profile(),
    { id } = await game.createGame(p, setup());
  const t = await play(p, id);
  await assert.rejects(
    () => game.score(id, p, { instanceId: t.id, outcome: "correct" }),
    (e: any) => e.code === "REVEAL_FIRST",
  );
  await game.reveal(id, p);
  assert.ok((await game.gameState(id, p)).current?.answer);
  await Promise.all([
    game.score(id, p, { instanceId: t.id, outcome: "correct" }),
    game.score(id, p, { instanceId: t.id, outcome: "correct" }),
  ]);
  const state = await game.gameState(id, p);
  assert.equal(state.teams[0].score, t.value);
  assert.equal(state.activeTeam, 1);
  assert.equal(
    (
      await pool.query("SELECT * FROM score_events WHERE instance_id=$1", [
        t.id,
      ])
    ).rowCount,
    1,
  );
});
test("Skipped questions remain excluded and full game completes with no repeated scores", async () => {
  const p = await profile(),
    { id } = await game.createGame(p, setup());
  for (let i = 0; i < 3; i++) {
    const tile = await play(p, id);
    await game.reveal(id, p);
    await game.score(id, p, {
      instanceId: tile.id,
      outcome: i === 0 ? "skipped" : "correct",
    });
  }
  const state = await game.gameState(id, p);
  assert.equal(state.status, "finished");
  assert.equal(
    (await pool.query("SELECT * FROM exposures WHERE profile_id=$1", [p]))
      .rowCount,
    3,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM exposures WHERE profile_id=$1 AND outcome='skipped'",
        [p],
      )
    ).rowCount,
    1,
  );
});
test("Lifelines are limited and survive refresh", async () => {
  const p = await profile(),
    { id } = await game.createGame(p, setup());
  await play(p, id);
  const s = await game.lifeline(id, p, "double");
  assert.equal(s.current.multiplier, 2);
  await assert.rejects(
    () => game.lifeline(id, p, "double"),
    (e: any) => e.code === "LIFELINE_USED",
  );
  await game.lifeline(id, p, "hint");
  assert.ok((await game.gameState(id, p)).current?.hint);
});
test("Account linking unions histories; sessions on two devices map to one account", async () => {
  const guest = await profile(),
    account = await profile("account"),
    u = randomUUID();
  await pool.query(
    "INSERT INTO users(id,profile_id,username,password_hash) VALUES($1,$2,$3,$4)",
    [
      u,
      account,
      "account_" + u.slice(0, 8),
      hashPassword("test account password"),
    ],
  );
  const a = await game.createGame(account, setup()),
    g = await game.createGame(guest, setup());
  await play(account, a.id);
  await play(guest, g.id);
  const expected = await pool.query(
    "SELECT DISTINCT question_id FROM exposures WHERE profile_id=ANY($1::uuid[])",
    [[guest, account]],
  );
  await mergeProfiles(guest, account);
  assert.equal((await game.gameState(a.id, account)).status, "active");
  assert.equal(
    (await pool.query("SELECT * FROM exposures WHERE profile_id=$1", [account]))
      .rowCount,
    expected.rowCount,
  );
  for (const token of ["device-one", "device-two"])
    await pool.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 day',now())",
      [tokenHash(token), account],
    );
  assert.equal(
    (
      await pool.query(
        "SELECT DISTINCT profile_id FROM sessions WHERE token_hash=ANY($1)",
        [[tokenHash("device-one"), tokenHash("device-two")]],
      )
    ).rowCount,
    1,
  );
});
test("Different users may see the same question; ownership prevents reading another game", async () => {
  const p = await profile(),
    other = await profile();
  const a = await game.createGame(p, setup());
  await assert.rejects(
    () => game.gameState(a.id, other),
    (e: any) => e.code === "GAME_NOT_FOUND",
  );
  const b = await game.createGame(other, {
    ...setup(),
    questionsPerCategory: 6,
  });
  assert.equal((await game.gameState(b.id, other)).tiles.length, 6);
  const t = await play(p, a.id),
    {
      rows: [q],
    } = await pool.query("SELECT question_id FROM game_questions WHERE id=$1", [
      t.id,
    ]);
  const {
    rows: [match],
  } = await pool.query(
    "SELECT id FROM game_questions WHERE game_id=$1 AND question_id=$2",
    [b.id, q.question_id],
  );
  assert.ok(match);
  await game.openQuestion(b.id, other, match.id);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM exposures WHERE question_id=$1 AND profile_id=ANY($2::uuid[])",
        [q.question_id, [p, other]],
      )
    ).rowCount,
    2,
  );
});
test("Shared participants exclude seen questions and get exposure on shared display", async () => {
  const host = await profile(),
    participant = await profile(),
    seen = await game.createGame(participant, setup());
  const t = await play(participant, seen.id);
  await game.abandon(seen.id, participant);
  const token = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO participant_tokens VALUES($1,$2,now()+interval '10 minutes',null)",
    [tokenHash(token), participant],
  );
  const shared = await game.createGame(host, {
    ...setup(),
    participantTokens: [token],
  });
  const tile = await play(host, shared.id);
  assert.equal(
    (
      await pool.query("SELECT * FROM exposures WHERE instance_id=$1", [
        tile.id,
      ])
    ).rowCount,
    2,
  );
  await assert.rejects(
    () =>
      game.createGame(host, {
        ...setup(["science"]),
        participantTokens: [token],
      }),
    (e: any) => e.code === "PARTICIPANT_TOKEN",
  );
  const missing = await pool.query(
    "SELECT 1 FROM game_questions WHERE game_id=$1 AND question_id=(SELECT question_id FROM game_questions WHERE id=$2)",
    [shared.id, t.id],
  );
  assert.equal(missing.rowCount, 0);
});
test("Exact, normalized and structured paraphrases are rejected globally", async () => {
  const {
    rows: [q],
  } = await pool.query(
    "SELECT * FROM questions WHERE fact_key='australia:capital'",
  );
  const c = {
    text: "اذكر العاصمة الرسمية لأستراليا.",
    answer: "كانبرا",
    explanation: "كانبرا هي العاصمة الرسمية لأستراليا.",
    hint: "مدينة أسترالية.",
    factKey: q.fact_key,
    subject: q.subject,
    predicate: q.predicate,
    fact: q.fact,
    categoryIds: ["culture"],
    difficulty: "easy",
    provenance: "Original test proposal",
    sources: [
      {
        url: "https://www.britannica.com/place/Canberra",
        citation: "Capital of Australia",
      },
    ],
  };
  assert.equal((await ingest(c)).status, "duplicate");
  assert.equal(
    (
      await ingest({
        ...c,
        factKey: "different:key",
        text: q.text.replace(/أ/g, "ا") + "!!!",
      })
    ).status,
    "duplicate",
  );
  assert.equal(
    (await ingest({ ...c, factKey: "different:another" })).status,
    "duplicate",
  );
  assert.equal(
    (
      await ingest({
        ...c,
        text: "ما البلد الذي تتّخذ كانبرا عاصمة له؟",
        subject: c.answer,
        answer: c.subject,
        factKey: "reverse:capital",
        predicate: "capital-of",
      })
    ).status,
    "duplicate",
  );
});
test("Direction-independent facts and semantic vector retrieval operate consistently", () => {
  assert.equal(
    factSignature({
      subject: "أستراليا",
      predicate: "capital",
      answer: "كانبرا",
    }),
    factSignature({
      subject: "كانبرا",
      predicate: "عاصمة",
      answer: "استراليا",
    }),
  );
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1], [1, 2]), 0);
});
test("Unverified candidate never enters gameplay; newly approved content is available without resetting history", async () => {
  const p = await profile(),
    adminProfile = await profile("account"),
    adminId = randomUUID();
  await pool.query("INSERT INTO users VALUES($1,$2,$3,$4,'admin',now())", [
    adminId,
    adminProfile,
    "admin_test",
    hashPassword("admin test password"),
  ]);
  const c = candidateSchema.parse({
    text: "كم يساوي حاصل 19 ضرب 19؟",
    answer: "361",
    explanation: "19 × 19 = 361.",
    hint: "احسب 20 × 19 ثم اطرح 19.",
    factKey: "arithmetic:19x19",
    subject: "19,19",
    predicate: "multiply",
    fact: "19*19=361",
    categoryIds: ["isolated"],
    difficulty: "easy",
    provenance: "Original deterministic test",
    deterministic: true,
  });
  const candidate = await ingest(c);
  assert.equal(candidate.status, "review");
  assert.equal(
    (await pool.query("SELECT 1 FROM questions WHERE fact_key=$1", [c.factKey]))
      .rowCount,
    0,
  );
  await transaction((db) =>
    publishCandidate(
      db,
      candidate.id,
      adminId,
      "Verified arithmetic directly: 19 times 19 equals 361.",
      true,
    ),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM questions WHERE fact_key=$1 AND status='approved'",
        [c.factKey],
      )
    ).rowCount,
    1,
  );
});
test("Background generation creates review candidates and enforces finite job state", async () => {
  await pool.query("DELETE FROM generation_jobs");
  await pool.query(
    "INSERT INTO generation_jobs(id,category_id,kind,count) VALUES($1,'logic','arithmetic',2)",
    [randomUUID()],
  );
  await runJob();
  assert.equal(
    (await pool.query("SELECT 1 FROM generation_jobs WHERE status='finished'"))
      .rowCount,
    1,
  );
  assert.ok(
    (
      await pool.query(
        "SELECT 1 FROM candidates WHERE status='review' AND payload->>'deterministic'='true'",
      )
    ).rowCount! >= 1,
  );
});
test("Expired timer cannot award the active team and unauthorized scoring fails", async () => {
  const p = await profile(),
    other = await profile(),
    { id } = await game.createGame(p, setup());
  const t = await play(p, id);
  await game.reveal(id, p);
  await pool.query(
    "UPDATE game_questions SET deadline=now()-interval '1 second' WHERE id=$1",
    [t.id],
  );
  await assert.rejects(
    () => game.score(id, p, { instanceId: t.id, outcome: "correct" }),
    (e: any) => e.code === "TIMER_EXPIRED",
  );
  await assert.rejects(
    () => game.score(id, other, { instanceId: t.id, outcome: "correct" }),
    (e: any) => e.code === "GAME_NOT_FOUND",
  );
  await game.score(id, p, { instanceId: t.id, outcome: "skipped" });
});
test("A stolen question does not transfer the opposing double-points lifeline", async () => {
  const p = await profile(),
    { id } = await game.createGame(p, setup());
  const tile = await play(p, id);
  await game.lifeline(id, p, "double");
  await game.reveal(id, p);
  const state = await game.score(id, p, {
    instanceId: tile.id,
    outcome: "correct",
    team: 1,
  });
  assert.equal(state.teams[1].score, tile.value);
});
test("Production excludes development seeds rather than claiming unverified facts are release content", async () => {
  const p = await profile(),
    previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      () => game.createGame(p, setup()),
      (e: any) => e.code === "FRESH_POOL_EXHAUSTED",
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
test("New editorial approvals refill an exhausted pool without erasing exposure history", async () => {
  const p = await profile(),
    actorProfile = await profile("account"),
    actor = randomUUID();
  await pool.query(
    "INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,$4,'editor')",
    [
      actor,
      actorProfile,
      "editor_" + actor.slice(0, 8),
      hashPassword("editor pipeline password"),
    ],
  );
  await pool.query(
    "INSERT INTO categories(id,name,description,icon,color) VALUES('pipeline','اختبار المخزون','أسئلة جديدة معتمدة','◇','#eee')",
  );
  const drafts = [];
  for (const [i, a] of [101, 102, 103].entries()) {
    const c = candidateSchema.parse({
      text: `كم يساوي حاصل ${a} ضرب 37؟`,
      answer: String(a * 37),
      explanation: `${a} × 37 = ${a * 37}.`,
      hint: "اضرب في ثلاثين ثم في سبعة.",
      factKey: `pipeline:${a}*37`,
      subject: `${a},37`,
      predicate: "multiply",
      fact: `${a}*37=${a * 37}`,
      categoryIds: ["pipeline"],
      difficulty: ["easy", "medium", "hard"][i],
      deterministic: true,
      provenance: "Original pipeline integration test",
    });
    const d = await ingest(c);
    drafts.push(d);
  }
  await assert.rejects(
    () => game.createGame(p, setup(["pipeline"])),
    (e: any) => e.code === "FRESH_POOL_EXHAUSTED",
  );
  for (const draft of drafts)
    await transaction((db) =>
      publishCandidate(
        db,
        draft.id,
        actor,
        "Verified exact arithmetic and reviewed independent fact identity.",
        true,
      ),
    );
  const first = await game.createGame(p, setup(["pipeline"]));
  const tile = await play(p, first.id);
  await game.abandon(first.id, p);
  const {
    rows: [seen],
  } = await pool.query("SELECT question_id FROM game_questions WHERE id=$1", [
    tile.id,
  ]);
  await assert.rejects(
    () => game.createGame(p, setup(["pipeline"])),
    (e: any) => e.code === "FRESH_POOL_EXHAUSTED",
  );
  const replacement = await ingest({
    text: "كم يساوي حاصل 104 ضرب 37؟",
    answer: "3848",
    explanation: "104 × 37 = 3848.",
    hint: "اضرب مئة وأربعة في 37.",
    factKey: "pipeline:104*37",
    subject: "104,37",
    predicate: "multiply",
    fact: "104*37=3848",
    categoryIds: ["pipeline"],
    difficulty: "easy",
    deterministic: true,
    provenance: "Original replacement integration test",
  });
  await transaction((db) =>
    publishCandidate(
      db,
      replacement.id,
      actor,
      "Verified multiplication and reviewed the canonical fact identity.",
      true,
    ),
  );
  const second = await game.createGame(p, setup(["pipeline"]));
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM game_questions WHERE game_id=$1 AND question_id=$2",
        [second.id, seen.question_id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM exposures WHERE profile_id=$1", [p]))
      .rowCount,
    1,
  );
  assert.equal(verifyArithmetic("19*19=361"), true);
  assert.equal(verifyArithmetic("19*19=999"), false);
  assert.equal(verifyArithmetic("unsupported calculation"), false);
});

test("Release verification preserves canonical IDs and every existing exposure", async () => {
  const p = await profile(),
    { id } = await game.createGame(p, setup());
  const tile = await play(p, id);
  await game.abandon(id, p);
  const {
    rows: [q],
  } = await pool.query(
    "SELECT q.* FROM questions q JOIN game_questions i ON i.question_id=q.id WHERE i.id=$1",
    [tile.id],
  );
  const actorProfile = await profile("account"),
    actor = randomUUID();
  await pool.query(
    "INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,$4,'editor')",
    [
      actor,
      actorProfile,
      "release_" + actor.slice(0, 8),
      hashPassword("release verifier password"),
    ],
  );
  await assert.rejects(
    () =>
      transaction((db) =>
        verifyCanonical(
          db,
          q.id,
          actor,
          [],
          "Unsupported verification attempt.",
        ),
      ),
    (e: any) => e.code === "EVIDENCE_REQUIRED",
  );
  await transaction((db) =>
    verifyCanonical(
      db,
      q.id,
      actor,
      [
        {
          url: "https://example.org/verified-fact",
          citation: "Integration fixture: editor-verified evidence.",
        },
      ],
      "Editorial workflow test; no claim of real source verification.",
    ),
  );
  assert.equal(
    (
      await pool.query("SELECT development_only FROM questions WHERE id=$1", [
        q.id,
      ])
    ).rows[0].development_only,
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM exposures WHERE profile_id=$1 AND question_id=$2",
        [p, q.id],
      )
    ).rowCount,
    1,
  );
});

test("Only administrators can change roles and the final administrator cannot be demoted", async () => {
  const aProfile = await profile("account"),
    pProfile = await profile("account"),
    a = randomUUID(),
    p = randomUUID();
  await pool.query(
    "INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,$4,'admin'),($5,$6,$7,$4,'player')",
    [
      a,
      aProfile,
      "manager_" + a.slice(0, 8),
      hashPassword("manager integration password"),
      p,
      pProfile,
      "player_" + p.slice(0, 8),
    ],
  );
  await assert.rejects(
    () => updateRole(p, p, "admin", "Unauthorized role escalation attempt"),
    (e: any) => e.code === "ADMIN_REQUIRED",
  );
  await updateRole(
    a,
    p,
    "editor",
    "Authorized role upgrade for editorial work",
  );
  assert.equal(
    (await pool.query("SELECT role FROM users WHERE id=$1", [p])).rows[0].role,
    "editor",
  );
  const others = await pool.query(
    "SELECT id FROM users WHERE role='admin' AND id!=$1",
    [a],
  );
  for (const u of others.rows)
    await updateRole(
      a,
      u.id,
      "editor",
      "Isolated test fixture: reduce admin count",
    );
  await assert.rejects(
    () => updateRole(a, a, "player", "Attempt to remove final administrator"),
    (e: any) => e.code === "LAST_ADMIN",
  );
  assert.equal(
    (await pool.query("SELECT role FROM users WHERE id=$1", [a])).rows[0].role,
    "admin",
  );
});

test("Overlapping category pools allocate a complete board without consuming scarce shared facts early",async()=>{
  for(const id of ["allocation-a","allocation-b"]) await pool.query("INSERT INTO categories(id,name,description,icon,color) VALUES($1,$1,'اختبار مخزون مشترك','◇','#eee')",[id]);
  for(let i=0;i<6;i++) {
    const a=100000+i;
    await transaction(db=>insertQuestion(db,candidateSchema.parse({text:`كم يساوي حاصل ${a} ضرب 31؟`,answer:String(a*31),explanation:`${a}*31=${a*31}.`,hint:"احسب حاصل الضرب.",factKey:"allocation:"+i,subject:String(a),predicate:"allocation-multiply",fact:`${a}*31=${a*31}`,categoryIds:i%2===0?["allocation-a","allocation-b"]:["allocation-a"],difficulty:["easy","medium","hard"][Math.floor(i/2)],deterministic:true,provenance:"Isolated shared-pool integration fixture"})));
  }
  for(let i=0;i<8;i++) {
    const p=await profile(),{id}=await game.createGame(p,setup(["allocation-a","allocation-b"]));
    const {rows}=await pool.query("SELECT question_id FROM game_questions WHERE game_id=$1",[id]);assert.equal(new Set(rows.map(q=>q.question_id)).size,6);
  }
});

test("Semantic reservations share a transactional cap, while zero budget still permits arithmetic jobs",async()=>{
  const {reserveSemanticBudget}=await import("../server/content-budget.ts"),{startEmbeddedWorker,wakeWorker}=await import("../server/worker.ts");
  const previous=process.env.GENERATION_DAILY_BUDGET_CENTS;
  await pool.query("DELETE FROM generation_budget");await pool.query("DELETE FROM generation_jobs");
  process.env.GENERATION_DAILY_BUDGET_CENTS="3";
  const results=await Promise.allSettled([reserveSemanticBudget(2),reserveSemanticBudget(2)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await pool.query("SELECT reserved_cents FROM generation_budget")).rows[0].reserved_cents,2);
  process.env.GENERATION_DAILY_BUDGET_CENTS="0";
  const model=randomUUID(),arithmetic=randomUUID();
  await pool.query("INSERT INTO generation_jobs(id,category_id,kind,count) VALUES($1,'logic','model',1),($2,'logic','arithmetic',2)",[model,arithmetic]);
  const stop=startEmbeddedWorker();wakeWorker();
  try {
    let done=false;
    for(let i=0;i<100;i++) {
      const {rows}=await pool.query("SELECT id,status FROM generation_jobs WHERE id=ANY($1)",[[model,arithmetic]]);
      if(rows.find(r=>r.id===model)?.status==="failed" && rows.find(r=>r.id===arithmetic)?.status==="finished"){done=true;break;}
      await new Promise(r=>setTimeout(r,20));
    }
    assert.ok(done);assert.equal((await pool.query("SELECT reserved_cents FROM generation_budget")).rows[0].reserved_cents,2);
  } finally {await stop();if(previous===undefined)delete process.env.GENERATION_DAILY_BUDGET_CENTS;else process.env.GENERATION_DAILY_BUDGET_CENTS=previous;}
});

test("A stale worker cannot complete a reclaimed lease owned by a newer worker",async()=>{
  await pool.query("DELETE FROM generation_jobs");
  await pool.query("CREATE FUNCTION slow_candidate_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER slow_candidate_fixture BEFORE INSERT ON candidates FOR EACH ROW EXECUTE FUNCTION slow_candidate_fixture()");
  const id=randomUUID();await pool.query("INSERT INTO generation_jobs(id,category_id,kind,count) VALUES($1,'logic','arithmetic',2)",[id]);
  try {
    const first=runJob();
    for(let i=0;i<100;i++){if((await pool.query("SELECT status FROM generation_jobs WHERE id=$1",[id])).rows[0].status==="running")break;await new Promise(r=>setTimeout(r,10));}
    await pool.query("UPDATE generation_jobs SET leased_at=now()-interval '6 minutes',count=20 WHERE id=$1",[id]);
    const second=runJob();await first;
    const current=(await pool.query("SELECT status,attempts FROM generation_jobs WHERE id=$1",[id])).rows[0];assert.equal(current.status,"running");assert.equal(current.attempts,2);
    await second;assert.equal((await pool.query("SELECT status FROM generation_jobs WHERE id=$1",[id])).rows[0].status,"finished");
  } finally {await pool.query("DROP TRIGGER slow_candidate_fixture ON candidates; DROP FUNCTION slow_candidate_fixture()");}
});

test("Media byte identity defeats copied asset IDs, and changed drafts invalidate older reviews",async()=>{
  const {ingestWith}=await import("../server/content.ts");
  const pack=JSON.parse(await readFile("media/release-pack.json","utf8")),asset=pack.assets[0],copy=randomUUID();
  for(const [id,key] of [[asset.id,asset.objectKey],[copy,copy+".svg"]]) await pool.query("INSERT INTO media_assets(id,mime,storage,object_key,size_bytes,sha256,credit,license) VALUES($1,$2,'bundle',$3,$4,$5,$6,$7)",[id,asset.mime,key,asset.sizeBytes,asset.sha256,asset.credit,asset.license]);
  const raw={...pack.questions[0],categoryIds:["culture"],factKey:"media-hash-original"},first=await ingest(raw);
  assert.equal((await ingest({...raw,factKey:"media-hash-copy",subject:"changed-subject",media:{...raw.media,assetId:copy}})).status,"duplicate");
  await transaction(db=>ingestWith(db,candidateSchema.parse({...raw,hint:"مراجعة جديدة للتلميح."}),first.id));
  assert.equal((await pool.query("SELECT revision FROM candidates WHERE id=$1",[first.id])).rows[0].revision,2);
  const actor=(await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows[0].id;
  await assert.rejects(()=>transaction(db=>publishCandidate(db,first.id,actor,"Review of an older draft must not publish changed content.",true,1)),(e:any)=>e.code==="REVIEW_CHANGED");
  const triangle=(await pool.query("SELECT id FROM questions WHERE fact_key='triangle:sides'")).rows[0];
  await assert.rejects(()=>transaction(db=>verifyCanonical(db,triangle.id,actor,[],"Arithmetic cannot verify an unrelated geometric assertion.","3+0=3")),(e:any)=>e.code==="EVIDENCE_REQUIRED");
});

test("Ranked team assignments require accounts linked before play and preserve token order", async () => {
  const guest = await profile(), host = await profile("account"), teammate = await profile("account");
  for (const p of [host,teammate]) {
    const id=randomUUID();
    await pool.query("INSERT INTO users(id,profile_id,username,password_hash) VALUES($1,$2,$3,$4)",[id,p,"teams_"+id.slice(0,8),hashPassword("team linkage test password")]);
  }
  const unranked=await game.createGame(guest,{...setup(),hostTeam:1});
  assert.equal((await pool.query("SELECT team_index FROM game_participants WHERE game_id=$1 AND profile_id=$2",[unranked.id,guest])).rows[0].team_index,null);
  await game.abandon(unranked.id,guest);
  const token="team-membership-"+randomUUID();
  await pool.query("INSERT INTO participant_tokens(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[tokenHash(token),teammate]);
  const linked=await game.createGame(host,{...setup(),hostTeam:1,participantTokens:[token],participantTeams:[0]});
  const assignments=new Map((await pool.query("SELECT profile_id,team_index FROM game_participants WHERE game_id=$1",[linked.id])).rows.map(p=>[p.profile_id,p.team_index]));
  assert.equal(assignments.get(host),1);assert.equal(assignments.get(teammate),0);
  assert.equal(game.setupSchema.safeParse({...setup(),participantTokens:[token],participantTeams:[]}).success,false);
  assert.equal(game.setupSchema.safeParse({...setup(),teamNames:["الصُّقور","الصقور"]}).success,false);
  await game.abandon(linked.id,host);
});

test("Original submitted puzzles stay pending and human approval stores their proof", async()=>{
  const {submitQuestion}=await import("../server/submissions.ts");
  const p=await profile("account"),actor=randomUUID();
  await pool.query("INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,$4,'editor')",[actor,p,"manual_"+actor.slice(0,8),hashPassword("manual original editorial test")]);
  const suffix=randomUUID();
  const submitted=await submitQuestion({text:"في هذا اللغز الأصلي للاختبار، كم عنصرًا نعدّ؟ "+suffix,answer:"7",explanation:"عدّدت العناصر الأصلية واحدًا واحدًا وتحققت من أن العدد سبعة.",hint:"عدّ كل عنصر مرة واحدة.",categoryIds:["logic"],difficulty:"medium",format:"text",evidenceKind:"original",fact:"دليل الحل الأصلي: سبعة عناصر موضّحة في اللغز "+suffix,provenance:"أعددت لغز العد الأصلي بنفسي وراجعت الحل."},actor);
  assert.equal(submitted.status,"review");
  assert.equal((await pool.query("SELECT 1 FROM questions WHERE id=$1",[submitted.id])).rowCount,0);
  await transaction(db=>publishCandidate(db,submitted.id,actor,"راجعت الدليل وعدّ العناصر، وتحققت من سلامة الحل وأصل السؤال.",true,1));
  const proof=(await pool.query("SELECT url,citation,verification_method FROM evidence WHERE question_id=$1",[submitted.id])).rows[0];
  assert.equal(proof.url,null);assert.equal(proof.verification_method,"editorial-original");
  assert.match(proof.citation,/سبعة عناصر/);
  assert.equal((await pool.query("SELECT deterministic FROM candidates, jsonb_to_record(payload) AS x(deterministic boolean) WHERE id=$1",[submitted.id])).rows[0].deterministic,false);
});

test("Background reads do not reissue fresh session cookies across an authentication rotation", async()=>{
  const {identity}=await import("../server/auth.ts"),p=await profile();
  const token="rotation-race-"+randomUUID();
  await pool.query("INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '180 days')",[tokenHash(token),p]);
  const cookies:unknown[]=[];
  const req:any={headers:{cookie:"nabeeh_session="+token}};
  const res:any={cookie:(...args:unknown[])=>cookies.push(args)};
  let error:unknown;
  await identity(req,res,e=>{error=e;});
  assert.equal(error,undefined);assert.equal(req.identity.profileId,p);assert.equal(cookies.length,0);
  await pool.query("UPDATE sessions SET expires_at=now()+interval '178 days' WHERE token_hash=$1",[tokenHash(token)]);
  await identity(req,res,e=>{error=e;});assert.equal(error,undefined);assert.equal(cookies.length,1);
  await identity(req,res,e=>{error=e;});assert.equal(cookies.length,1);
});
