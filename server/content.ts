import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { transaction, AppError } from "./db.ts";
import { factSignature } from "./semantic.ts";
import { mediaSchema } from "./media.ts";
export function normalizeArabic(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
export const digest = (text: string) =>
  createHash("sha256").update(normalizeArabic(text)).digest("hex");
export async function contentDigest(
  db: Pick<pg.PoolClient, "query">,
  c: {
    text: string;
    format?: string;
    options?: string[];
    media?: { assetId: string };
  },
) {
  const textHash = digest(c.text);
  if (!c.media)
    return c.format === "ordering" && c.options
      ? createHash("sha256")
          .update(
            textHash +
              ":ordering:" +
              JSON.stringify(c.options.map(normalizeArabic).sort()),
          )
          .digest("hex")
      : textHash;
  const {
    rows: [asset],
  } = await db.query("SELECT sha256 FROM media_assets WHERE id=$1", [
    c.media.assetId,
  ]);
  if (!asset) throw new AppError(400, "MEDIA_INVALID", "الوسائط غير موجودة.");
  // Different stimuli can share a prompt. Copies with identical bytes share a digest.
  return createHash("sha256")
    .update(textHash + ":media:" + asset.sha256)
    .digest("hex");
}
export function verifyArithmetic(fact: string): boolean {
  const match = fact
    .replace(/\s/g, "")
    .match(/^(\d{1,6})([*+\/-])(\d{1,6})(?:([+\-])(\d{1,6}))?=(\d{1,12})$/);
  if (!match) return false;
  const [, a, op, b, second, c, result] = match;
  let value =
    op === "*"
      ? Number(a) * Number(b)
      : op === "+"
        ? Number(a) + Number(b)
        : op === "-"
          ? Number(a) - Number(b)
          : Number(a) / Number(b);
  if (second) value += second === "+" ? Number(c) : -Number(c);
  return Number.isFinite(value) && value === Number(result);
}
export function verifyOriginalProof(
  c: Pick<Candidate, "fact" | "answer" | "orderingAnswer">,
) {
  if (verifyArithmetic(c.fact))
    return normalizeArabic(c.answer) === c.fact.match(/=(\d+)$/)?.[1];
  const sort = /^(ascending|descending):([0-9,]+)=([0-9,]+)$/.exec(c.fact);
  if (sort) {
    const numbers = sort[2].split(",").map(Number);
    const sorted = [...numbers]
      .sort((a, b) => (sort[1] === "ascending" ? a - b : b - a))
      .map(String);
    return (
      new Set(numbers).size === numbers.length &&
      JSON.stringify(sorted) === JSON.stringify(sort[3].split(",")) &&
      JSON.stringify(sorted) === JSON.stringify(c.orderingAnswer) &&
      c.answer === sorted.join("، ")
    );
  }
  const anagram = /^anagram:([^=]+)=([^=]+)$/.exec(c.fact);
  if (anagram) {
    const letters = (s: string) =>
      [...normalizeArabic(s).replace(/ /g, "")].sort().join("");
    return (
      letters(anagram[1]) === letters(anagram[2]) &&
      normalizeArabic(c.answer) === normalizeArabic(anagram[2])
    );
  }
  return false;
}
export async function verifyCanonical(
  db: pg.PoolClient,
  id: string,
  actor: string,
  sources: { url: string; citation: string }[],
  note: string,
  verifiedFact?: string,
) {
  const {
    rows: [q],
  } = await db.query("SELECT * FROM questions WHERE id=$1 FOR UPDATE", [id]);
  if (!q || q.status !== "approved")
    throw new AppError(409, "NOT_APPROVED", "السؤال غير متاح للتحقّق.");
  const result = verifiedFact?.match(/=(\d+)$/)?.[1];
  const deterministic =
    !!verifiedFact &&
    verifiedFact === q.fact &&
    verifyArithmetic(verifiedFact) &&
    normalizeArabic(q.answer) === result;
  if (!sources.length && !deterministic)
    throw new AppError(
      400,
      "EVIDENCE_REQUIRED",
      "أضف مصدرًا محدّدًا تمّت مراجعته، أو حسابًا صحيحًا يطابق الإجابة.",
    );
  await db.query("DELETE FROM evidence WHERE question_id=$1", [id]);
  for (const source of sources)
    await db.query(
      "INSERT INTO evidence(id,question_id,url,citation,verified_at,verification_method) VALUES($1,$2,$3,$4,now(),'editorial')",
      [randomUUID(), id, source.url, source.citation],
    );
  if (deterministic)
    await db.query(
      "INSERT INTO evidence(id,question_id,citation,verified_at,verification_method) VALUES($1,$2,$3,now(),'deterministic')",
      [randomUUID(), id, verifiedFact],
    );
  await db.query(
    "UPDATE questions SET development_only=false,reviewed_by=$2,verified_at=now() WHERE id=$1",
    [id, actor],
  );
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'verify-release-question',$2,$3)",
    [actor, id, { note, sourceCount: sources.length, deterministic }],
  );
}
// Taa marbuta and hamza on waw/ya remain distinct. Aliases are editorial, never fuzzy scoring.
export const candidateSchema = z
  .object({
    text: z.string().min(8).max(600),
    answer: z.string().min(1).max(300),
    aliases: z.array(z.string().min(1).max(300)).max(20).default([]),
    explanation: z.string().min(8).max(2000),
    hint: z.string().min(2).max(300),
    factKey: z.string().min(5).max(250),
    subject: z.string().min(1).max(200),
    predicate: z.string().min(1).max(200),
    fact: z.string().min(5).max(1000),
    categoryIds: z.array(z.string().min(1).max(80)).min(1).max(5),
    difficulty: z.enum(["easy", "medium", "hard", "expert"]),
    format: z
      .enum(["text", "choice", "ordering", "word", "image", "audio", "video"])
      .default("text"),
    options: z.array(z.string().min(1).max(200)).min(2).max(8).optional(),
    orderingAnswer: z
      .array(z.string().min(1).max(200))
      .min(2)
      .max(8)
      .optional(),
    media: mediaSchema.optional(),
    region: z.enum(["all", "sa", "kw", "ae", "bh", "qa", "om"]).default("all"),
    tags: z.array(z.string()).max(12).default([]),
    sources: z
      .array(
        z.object({
          url: z
            .string()
            .url()
            .refine((s) => s.startsWith("https://")),
          citation: z.string().min(5).max(1000),
        }),
      )
      .max(10)
      .default([]),
    provenance: z.string().min(5).max(500),
    evidenceKind: z.enum(["factual", "original"]).default("factual"),
    deterministic: z.boolean().default(false),
    expiresAt: z.string().datetime().optional(),
    sensitive: z.boolean().default(false),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (new Set(c.categoryIds).size !== c.categoryIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["categoryIds"],
        message: "اختر كل فئة مرة واحدة.",
      });
    if (
      c.evidenceKind === "original" &&
      (c.fact.trim().length < 12 || c.provenance.trim().length < 12)
    )
      ctx.addIssue({
        code: "custom",
        path: ["fact"],
        message: "أضف وصفًا واضحًا لدليل الحل وأصل المحتوى.",
      });
    if (["image", "audio", "video"].includes(c.format) && !c.media)
      ctx.addIssue({
        code: "custom",
        path: ["media"],
        message: "Media question requires a licensed asset",
      });
    if (
      c.format === "ordering" &&
      (!c.options ||
        !c.orderingAnswer ||
        new Set(c.options).size !== c.options.length ||
        JSON.stringify([...c.options].sort()) !==
          JSON.stringify([...c.orderingAnswer].sort()))
    )
      ctx.addIssue({
        code: "custom",
        path: ["orderingAnswer"],
        message: "Ordering answer must be a permutation of distinct options",
      });
    if (c.format === "choice" && (!c.options || !c.options.includes(c.answer)))
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice answer must be an option",
      });
  });
export type Candidate = z.infer<typeof candidateSchema>;
export function similarity(a: string, b: string) {
  const x = new Set(normalizeArabic(a).split(" ")),
    y = new Set(normalizeArabic(b).split(" "));
  return [...x].filter((t) => y.has(t)).length / new Set([...x, ...y]).size;
}
export async function ingest(input: unknown) {
  const c = candidateSchema.parse(input);
  return transaction(async (db) => ingestWith(db, c));
}
export async function ingestWith(
  db: pg.PoolClient,
  c: Candidate,
  existingId?: string,
) {
  if (
    (
      await db.query("SELECT id FROM categories WHERE id=ANY($1::text[])", [
        c.categoryIds,
      ])
    ).rowCount !== c.categoryIds.length
  )
    throw new AppError(400, "CATEGORY_INVALID", "اختر فئة موجودة لكل سؤال.");
  if (c.media) {
    const {
      rows: [asset],
    } = await db.query("SELECT mime FROM media_assets WHERE id=$1", [
      c.media.assetId,
    ]);
    if (!asset || !asset.mime.startsWith(c.format + "/"))
      throw new AppError(
        400,
        "MEDIA_INVALID",
        "الملف المرفق لا يطابق نوع السؤال.",
      );
  }
  const hash = await contentDigest(db, c),
    id = existingId || randomUUID(),
    signature = factSignature(c);
  // Global, cross-category exact/fact lookup. Do not trust a model's claim of originality.
  const obvious = await db.query(
    `SELECT id FROM questions WHERE normalized_hash=$1 OR fact_key=$2 OR fact_signature=$6 OR (subject=$3 AND predicate=$4 AND lower(answer)=lower($5)) UNION SELECT question_id FROM question_variants WHERE normalized_hash=$1`,
    [hash, c.factKey, c.subject, c.predicate, c.answer, signature],
  );
  const other = await db.query(
    "SELECT id FROM candidates WHERE (normalized_hash=$1 OR fact_key=$2) AND status IN('review','approved') AND id!=$3",
    [hash, c.factKey, id],
  );
  const duplicate = !!(obvious.rowCount || other.rowCount);
  await db.query(
    "INSERT INTO candidates(id,payload,normalized_hash,fact_key,status,reason,fact_signature) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,normalized_hash=EXCLUDED.normalized_hash,fact_key=EXCLUDED.fact_key,status=EXCLUDED.status,reason=EXCLUDED.reason,fact_signature=EXCLUDED.fact_signature,revision=candidates.revision+1",
    [
      id,
      c,
      hash,
      c.factKey,
      duplicate ? "duplicate" : "review",
      duplicate ? "exact-or-canonical-fact" : null,
      signature,
    ],
  );
  if (existingId) {
    await db.query("DELETE FROM duplicate_candidates WHERE candidate_id=$1", [
      id,
    ]);
    await db.query("DELETE FROM candidate_vectors WHERE candidate_id=$1", [id]);
    await db.query("DELETE FROM semantic_judgments WHERE candidate_id=$1", [
      id,
    ]);
  }
  if (!duplicate) {
    // Lexical retrieval is conservative and not a substitute for production embeddings.
    await db.query("SET LOCAL pg_trgm.similarity_threshold = 0.15");
    const { rows } = await db.query(
      "SELECT id,text,answer,subject,predicate FROM questions WHERE text % $1 OR (subject=$2 AND predicate=$3) OR lower(answer)=lower($4) ORDER BY similarity(text,$1) DESC LIMIT 150",
      [c.text, c.subject, c.predicate, c.answer],
    );
    for (const q of rows) {
      const score = Math.max(
        similarity(q.text, c.text),
        q.subject === c.subject && q.predicate === c.predicate ? 0.95 : 0,
      );
      if (
        score >= 0.4 ||
        normalizeArabic(q.answer) === normalizeArabic(c.answer)
      )
        await db.query("INSERT INTO duplicate_candidates VALUES($1,$2,$3,$4)", [
          id,
          q.id,
          score,
          "lexical-or-entity-review",
        ]);
    }
    await db.query(
      "INSERT INTO review_tasks(id,candidate_id,kind) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM review_tasks WHERE candidate_id=$2)",
      [randomUUID(), id, "source-and-semantic"],
    );
  }
  return { id, status: duplicate ? "duplicate" : "review" };
}
export async function publishCandidate(
  db: pg.PoolClient,
  id: string,
  actor: string,
  verificationNote: string,
  duplicateReviewed: boolean,
  expectedRevision?: number,
) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('nabeeh-content-publish'))",
  );
  const {
    rows: [row],
  } = await db.query("SELECT * FROM candidates WHERE id=$1 FOR UPDATE", [id]);
  if (!row || row.status !== "review")
    throw new AppError(409, "NOT_REVIEWABLE", "هذا السؤال غير متاح للاعتماد.");
  if (expectedRevision !== undefined && row.revision !== expectedRevision)
    throw new AppError(
      409,
      "REVIEW_CHANGED",
      "تغيّرت المسودة. حدّث القائمة وأعد المراجعة قبل الاعتماد.",
    );
  const c = candidateSchema.parse(row.payload);
  const originalReviewed =
    c.evidenceKind === "original" &&
    c.fact.trim().length >= 12 &&
    c.provenance.trim().length >= 12;
  if (
    !c.sources.length &&
    !originalReviewed &&
    (!c.deterministic || !verifyOriginalProof(c))
  )
    throw new AppError(
      400,
      "EVIDENCE_REQUIRED",
      "أضف مصدرًا موثوقًا للإجابة، أو دليلًا واضحًا لحل اللغز الأصلي قبل الاعتماد.",
    );
  if (c.sensitive && (c.sources.length < 2 || !c.expiresAt))
    throw new AppError(
      400,
      "CORROBORATION_REQUIRED",
      "السؤال الحساس يحتاج مصدرين مستقلّين وتاريخ مراجعة.",
    );
  if (
    !duplicateReviewed &&
    (
      await db.query(
        "SELECT 1 FROM duplicate_candidates WHERE candidate_id=$1",
        [id],
      )
    ).rowCount
  )
    throw new AppError(409, "DUPLICATE_REVIEW", "راجع تشابه الأسئلة أولًا.");
  const duplicate = await db.query(
    "SELECT id FROM questions WHERE normalized_hash=$1 OR fact_key=$2 OR fact_signature=$6 OR (subject=$3 AND predicate=$4 AND lower(answer)=lower($5))",
    [
      row.normalized_hash,
      c.factKey,
      c.subject,
      c.predicate,
      c.answer,
      factSignature(c),
    ],
  );
  if (duplicate.rowCount)
    throw new AppError(409, "DUPLICATE", "الحقيقة موجودة في المكتبة.");
  await insertQuestion(db, c, id, actor);
  await db.query(
    "UPDATE candidates SET status='approved',verified=true,verification_note=$2 WHERE id=$1",
    [id, verificationNote],
  );
  await db.query(
    "UPDATE review_tasks SET status='resolved',resolved_at=now(),assigned_to=$2 WHERE candidate_id=$1",
    [id, actor],
  );
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'approve-question',$2,$3)",
    [actor, id, { verificationNote, duplicateReviewed }],
  );
}
export async function insertQuestion(
  db: Pick<pg.PoolClient, "query">,
  c: Candidate,
  id: string = randomUUID(),
  actor: string | null = null,
) {
  if (c.media) {
    const {
      rows: [asset],
    } = await db.query("SELECT mime FROM media_assets WHERE id=$1", [
      c.media.assetId,
    ]);
    if (!asset || !asset.mime.startsWith(c.format + "/"))
      throw new AppError(
        400,
        "MEDIA_INVALID",
        "نوع الوسائط لا يطابق نوع السؤال.",
      );
  }
  await db.query(
    `INSERT INTO questions(id,fact_key,subject,predicate,fact,text,normalized_hash,answer,explanation,hint,difficulty,format,options,region,tags,status,provenance,verified_at,expires_at,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'approved',$16,now(),$17,$18)`,
    [
      id,
      c.factKey,
      c.subject,
      c.predicate,
      c.fact,
      c.text,
      await contentDigest(db, c),
      c.answer,
      c.explanation,
      c.hint,
      c.difficulty,
      c.format,
      c.options ? JSON.stringify(c.options) : null,
      c.region,
      c.tags,
      c.provenance,
      c.expiresAt ?? null,
      actor,
    ],
  );
  await db.query("UPDATE questions SET fact_signature=$2 WHERE id=$1", [
    id,
    factSignature(c),
  ]);
  await db.query(
    "UPDATE questions SET media_id=$2,media_alt=$3,media_transcript=$4,ordering_answer=$5 WHERE id=$1",
    [
      id,
      c.media?.assetId ?? null,
      c.media?.alt ?? null,
      c.media?.transcript ?? null,
      c.orderingAnswer ? JSON.stringify(c.orderingAnswer) : null,
    ],
  );
  for (const cat of c.categoryIds)
    await db.query("INSERT INTO question_categories VALUES($1,$2)", [id, cat]);
  for (const answer of new Set([c.answer, ...c.aliases]))
    await db.query(
      "INSERT INTO accepted_answers VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, normalizeArabic(answer), answer],
    );
  for (const source of c.sources)
    await db.query(
      "INSERT INTO evidence(id,question_id,url,citation,verification_method,verified_at) VALUES($1,$2,$3,$4,$5,now())",
      [randomUUID(), id, source.url, source.citation, "editorial"],
    );
  if (c.evidenceKind === "original")
    await db.query(
      "INSERT INTO evidence(id,question_id,citation,verification_method,verified_at) VALUES($1,$2,$3,'editorial-original',now())",
      [randomUUID(), id, c.fact],
    );
  if (c.deterministic)
    await db.query(
      "INSERT INTO evidence(id,question_id,citation,verification_method,verified_at) VALUES($1,$2,$3,'deterministic',now())",
      [randomUUID(), id, c.fact],
    );
  return id;
}
