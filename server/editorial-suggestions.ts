import type pg from "pg";
import { pool } from "./db.ts";
import { integerSetting } from "./config.ts";

export const editorialDifficulties = [
  "easy",
  "medium",
  "hard",
  "expert",
] as const;
export const editorialFormats = [
  "text",
  "choice",
  "ordering",
  "word",
  "image",
  "audio",
  "video",
] as const;
export type EditorialDifficulty = (typeof editorialDifficulties)[number];
export type EditorialFormat = (typeof editorialFormats)[number];
type Aggregate = {
  category_id: string;
  difficulty: EditorialDifficulty;
  format: EditorialFormat;
  region: string;
  approved: number;
  accepted: number;
  rejected: number;
  pending: number;
};
type Category = { id: string; name: string; region: string };
export type EditorialSuggestion = {
  categoryId: string;
  categoryName: string;
  difficulty: EditorialDifficulty;
  format: EditorialFormat;
  region: string;
  count: number;
  reason: string;
  approvedCount: number;
  reviewCount: number;
  approvalRate: number | null;
  pendingCount: number;
  action: "review" | "compose" | "generate";
  kind: "arithmetic" | "model" | null;
};
const difficultyNames: Record<EditorialDifficulty, string> = {
  easy: "سهل",
  medium: "متوسط",
  hard: "صعب",
  expert: "خبير",
};
const formatNames: Record<EditorialFormat, string> = {
  text: "نصي",
  choice: "اختيار من متعدد",
  ordering: "ترتيب",
  word: "حروف مبعثرة",
  image: "صورة",
  audio: "صوت",
  video: "فيديو",
};
const validRegions = new Set(["all", "sa", "kw", "ae", "bh", "qa", "om"]);
const generatedFormats = new Set<EditorialFormat>([
  "text",
  "choice",
  "word",
  "ordering",
]);

/** An explainable editorial ranking, not a trained model or a player profile. */
export function rankEditorialSuggestions(
  categories: Category[],
  data: Aggregate[],
  modelReady: boolean,
): EditorialSuggestion[] {
  const targets: (EditorialSuggestion & { score: number })[] = [];
  for (const category of categories) {
    const stats = data.filter((row) => row.category_id === category.id);
    const regionPreferences = [...validRegions]
      .map((region) => ({
        region,
        weight: stats
          .filter((row) => row.region === region)
          .reduce(
            (n, row) => n + Number(row.accepted) + Number(row.approved) * 0.25,
            0,
          ),
      }))
      .sort((a, b) => b.weight - a.weight);
    const region =
      validRegions.has(category.region) && category.region !== "all"
        ? category.region
        : regionPreferences[0]?.weight > 0
          ? regionPreferences[0].region
          : "all";
    const regional = stats.filter((row) => row.region === region);
    const editorialFocus = regional.some(
      (row) => Number(row.approved) + Number(row.accepted) > 0,
    )
      ? 150
      : 0;
    // Successful human decisions determine the preferred presentation. Rejected
    // submissions alone cannot make a format the default for a category.
    const preferences = editorialFormats
      .map((format) => {
        const rows = regional.filter((row) => row.format === format);
        const accepted = rows.reduce((n, row) => n + Number(row.accepted), 0);
        const rejected = rows.reduce((n, row) => n + Number(row.rejected), 0);
        const available = rows.reduce((n, row) => n + Number(row.approved), 0);
        return {
          format,
          accepted,
          weight: accepted
            ? (accepted * (accepted + 1)) / (accepted + rejected + 1)
            : available * 0.25,
        };
      })
      .sort(
        (a, b) =>
          b.weight - a.weight ||
          editorialFormats.indexOf(a.format) -
            editorialFormats.indexOf(b.format),
      );
    const preferred = preferences[0];
    for (const difficulty of editorialDifficulties) {
      const atLevel = regional.filter((row) => row.difficulty === difficulty);
      if (
        difficulty === "expert" &&
        !atLevel.some(
          (row) =>
            Number(row.approved) + Number(row.accepted) + Number(row.pending) >
            0,
        )
      )
        continue;
      const format =
        preferred.weight > 0
          ? preferred.format
          : atLevel
              .filter((row) => Number(row.pending) > 0)
              .sort((a, b) => Number(b.pending) - Number(a.pending))[0]
              ?.format || "text";
      const target = atLevel.filter((row) => row.format === format);
      const approvedCount = target.reduce(
        (n, row) => n + Number(row.approved),
        0,
      );
      const accepted = target.reduce((n, row) => n + Number(row.accepted), 0);
      const rejected = target.reduce((n, row) => n + Number(row.rejected), 0);
      const pendingCount = target.reduce(
        (n, row) => n + Number(row.pending),
        0,
      );
      const availableAtLevel = atLevel.reduce(
        (n, row) => n + Number(row.approved),
        0,
      );
      // Two at each standard level support one complete six-question board for
      // a fresh account. Coverage is library-wide; player histories stay private.
      const shortage = Math.max(0, 2 - availableAtLevel);
      if (!shortage && !pendingCount) continue;
      const reviewCount = accepted + rejected;
      const approvalRate = reviewCount
        ? Math.round((accepted / reviewCount) * 100)
        : null;
      const kind =
        category.id === "logic" && format === "text"
          ? "arithmetic"
          : generatedFormats.has(format)
            ? "model"
            : null;
      const action = pendingCount
        ? "review"
        : kind === "arithmetic" || (kind === "model" && modelReady)
          ? "generate"
          : "compose";
      const reason = [
        `المتاح للعب في هذا المستوى: ${availableAtLevel}؛ نهدف إلى سؤالين على الأقل لكل مستوى.`,
        preferred.accepted
          ? `صيغة ${formatNames[format]} شائعة في اختيارات المحررين المعتمدة لهذه الفئة.`
          : "لا توجد قرارات اعتماد كافية لتحديد صيغة مفضلة بعد.",
        pendingCount
          ? `توجد ${pendingCount} مسودات بهذه المواصفات؛ راجعها قبل إضافة مسودات جديدة.`
          : !generatedFormats.has(format)
            ? "أضف مادة أصلية أو مرخّصة لهذه الصيغة، ثم راجع السؤال يدويًا."
            : action === "compose"
              ? "يمكن إضافة السؤال يدويًا الآن؛ اقتراحات النموذج تحتاج إعداد مزوّد وميزانية."
              : "كل مسودة مولّدة تحتاج تحديدًا نهائيًا للصعوبة والفئة ومراجعة قبل الاعتماد.",
        ["word", "choice", "ordering"].includes(format)
          ? "الإضافة المبسّطة تدعم السؤال النصي؛ يمكنك إضافة سؤال نصي في الفئة والمستوى نفسيهما، أو استيراد هذه الصيغة من تبويب «التوليد والاستيراد»."
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      targets.push({
        categoryId: category.id,
        categoryName: category.name,
        difficulty,
        format,
        region,
        count: Math.min(6, pendingCount || Math.max(1, shortage)),
        reason,
        approvedCount,
        reviewCount,
        approvalRate,
        pendingCount,
        action,
        kind,
        score:
          shortage * 100 +
          editorialFocus +
          (pendingCount ? 20 : 0) +
          (difficulty === "expert" ? -10 : 0) -
          Math.min(rejected, 10),
      });
    }
  }
  return targets
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.categoryId.localeCompare(b.categoryId) ||
        editorialDifficulties.indexOf(a.difficulty) -
          editorialDifficulties.indexOf(b.difficulty),
    )
    .slice(0, 12)
    .map(({ score: _score, ...suggestion }) => suggestion);
}

export async function getEditorialSuggestions(
  db: Pick<pg.PoolClient, "query"> = pool,
) {
  const [categories, stats, budget] = await Promise.all([
    db.query<Category>("SELECT id,name,region FROM categories ORDER BY id"),
    db.query<Aggregate>(`
      WITH library AS (
        SELECT qc.category_id,q.difficulty,q.format,q.region,count(*)::int AS approved,
          0::int AS accepted,0::int AS rejected,0::int AS pending
        FROM questions q JOIN question_categories qc ON qc.question_id=q.id
        WHERE q.status='approved' AND NOT q.development_only AND q.verified_at IS NOT NULL
          AND (q.expires_at IS NULL OR q.expires_at>now())
        GROUP BY qc.category_id,q.difficulty,q.format,q.region
      ), decisions AS (
        SELECT category_id,c.payload->>'difficulty' AS difficulty,c.payload->>'format' AS format,
          COALESCE(c.payload->>'region','all') AS region,0::int AS approved,
          count(*) FILTER(WHERE c.status='approved' AND c.verified)::int AS accepted,
          count(*) FILTER(WHERE c.status='rejected')::int AS rejected,
          count(*) FILTER(WHERE c.status='review')::int AS pending
        FROM candidates c CROSS JOIN LATERAL jsonb_array_elements_text(c.payload->'categoryIds') AS category_id
        WHERE c.status IN ('approved','rejected','review')
        GROUP BY category_id,c.payload->>'difficulty',c.payload->>'format',COALESCE(c.payload->>'region','all')
      ) SELECT category_id,difficulty,format,region,sum(approved)::int AS approved,
        sum(accepted)::int AS accepted,sum(rejected)::int AS rejected,sum(pending)::int AS pending
      FROM (SELECT * FROM library UNION ALL SELECT * FROM decisions) totals
      GROUP BY category_id,difficulty,format,region`),
    db.query<{ reserved_cents: number }>(
      "SELECT reserved_cents FROM generation_budget WHERE day=current_date",
    ),
  ]);
  const budgetCents = integerSetting(
    "GENERATION_DAILY_BUDGET_CENTS",
    0,
    0,
    100000,
  );
  const reservedCents = Number(budget.rows[0]?.reserved_cents || 0);
  let validProvider = false;
  try {
    validProvider =
      new URL(process.env.MODEL_BASE_URL || "https://api.openai.com/v1")
        .protocol === "https:";
  } catch {
    /* Report configuration without revealing credentials. */
  }
  const configured = Boolean(process.env.MODEL_API_KEY && validProvider);
  const canGenerate = configured && budgetCents - reservedCents >= 50;
  return {
    suggestions: rankEditorialSuggestions(
      categories.rows,
      stats.rows,
      canGenerate,
    ),
    provider: {
      configured,
      budgetCents,
      reservedCents,
      canGenerate,
      modelName: (process.env.MODEL_NAME || "gpt-4.1-mini").slice(0, 100),
    },
    methodology:
      "ترتيب قابل للتفسير من توزيع الأسئلة المعتمدة وقرارات المحررين ونقص المخزون. ليس نموذجًا مدرّبًا، ولا يستخدم سجلّ اللاعبين. تبقى الفئة والصعوبة والاعتماد قرار المحرر.",
  };
}

/** At most three reviewed, non-expired examples stay inside editorial generation. */
export async function reviewedStyleExamples(
  categoryId: string,
  difficulty?: string | null,
  format?: string | null,
  region?: string | null,
) {
  const { rows } = await pool.query(
    `
    SELECT q.text,q.answer,q.explanation,q.hint,q.difficulty,q.format,q.options,
      q.ordering_answer AS "orderingAnswer",q.region,q.tags
    FROM questions q JOIN question_categories qc ON qc.question_id=q.id
    WHERE qc.category_id=$1 AND q.status='approved' AND q.reviewed_by IS NOT NULL
      AND NOT q.development_only AND q.verified_at IS NOT NULL
      AND (q.expires_at IS NULL OR q.expires_at>now())
      AND q.format IN ('text','choice','ordering','word')
    ORDER BY (q.difficulty=$2) DESC NULLS LAST,(q.format=$3) DESC NULLS LAST,
      (q.region=$4) DESC NULLS LAST,q.verified_at DESC,q.id LIMIT 3`,
    [categoryId, difficulty || null, format || null, region || null],
  );
  return rows;
}
