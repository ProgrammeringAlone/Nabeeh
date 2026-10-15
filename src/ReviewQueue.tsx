import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { difficultyLabels, formatLabels } from "./arabic";
import "./ReviewQueue.css";

type ReviewStatus = "review" | "duplicate" | "approved" | "rejected";
type Difficulty = "easy" | "medium" | "hard" | "expert";
type ReviewCategory = { id: string; name: string };
export type ReviewCandidate = {
  id: string;
  status: ReviewStatus;
  revision: number;
  verification_note?: string | null;
  reason?: string | null;
  payload: {
    text: string;
    answer: string;
    explanation: string;
    difficulty: Difficulty;
    categoryIds: string[];
    format: string;
    options?: string[];
    orderingAnswer?: string[];
    aliases?: string[];
    media?: {
      assetId: string;
      alt: string;
      transcript?: string;
      credit?: string;
      license?: string;
      source?: string;
    };
    sources?: { url: string; citation: string }[];
    evidenceKind?: "factual" | "original";
    provenance?: string;
    deterministic?: boolean;
    fact?: string;
    [key: string]: unknown;
  };
  duplicates: { id: string; text: string; answer: string; score?: number }[];
  [key: string]: unknown;
};
type QueueResponse = {
  items: ReviewCandidate[];
  page: number;
  total: number;
  totalPages: number;
  counts: Record<ReviewStatus, number>;
};
type Props = {
  categories: ReviewCategory[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  confirm: (message: string) => Promise<boolean>;
  onChanged: () => Promise<void>;
  onEdit: (candidate: ReviewCandidate) => void;
};
const levels: [Difficulty, string][] = (
  ["easy", "medium", "hard", "expert"] as Difficulty[]
).map((value) => [value, difficultyLabels[value]]);
const views: [ReviewStatus, string][] = [
  ["review", "بانتظار المراجعة"],
  ["duplicate", "تشابه محتمل"],
  ["approved", "المعتمدة"],
  ["rejected", "المرفوضة"],
];
const emptyCounts: Record<ReviewStatus, number> = {
  review: 0,
  duplicate: 0,
  approved: 0,
  rejected: 0,
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Nabeeh-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.message || "تعذّر تحميل قائمة المراجعة. حاول مرة أخرى.",
    );
  return result;
}

function ReviewCard({
  candidate,
  categories,
  busy,
  onEdit,
  onDecide,
}: {
  candidate: ReviewCandidate;
  categories: ReviewCategory[];
  busy: boolean;
  onEdit: Props["onEdit"];
  onDecide: (
    candidate: ReviewCandidate,
    action: "approve" | "reject",
    values: {
      verificationNote: string;
      duplicateReviewed: boolean;
      difficulty: Difficulty;
      categoryIds: string[];
    },
  ) => Promise<void>;
}) {
  const fieldId = useId();
  const [difficulty, setDifficulty] = useState<Difficulty>(
    candidate.payload.difficulty,
  );
  const [primaryCategory, setPrimaryCategory] = useState(
    candidate.payload.categoryIds[0] || "",
  );
  const [extraCategories, setExtraCategories] = useState(
    candidate.payload.categoryIds.slice(1),
  );
  const [note, setNote] = useState("");
  const [duplicateReviewed, setDuplicateReviewed] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const editable =
    candidate.status === "review" || candidate.status === "duplicate";
  const matches = candidate.duplicates || [];
  const categoryIds = [
    ...new Set([primaryCategory, ...extraCategories].filter(Boolean)),
  ];
  const validClassification =
    levels.some(([level]) => level === difficulty) &&
    categoryIds.length > 0 &&
    categoryIds.length <= 5 &&
    categoryIds.every((id) =>
      categories.some((category) => category.id === id),
    );
  const validNote = note.trim().length >= 12;
  const disabled = busy || deciding;
  const canApprove =
    candidate.status === "review" &&
    validClassification &&
    validNote &&
    (!matches.length || duplicateReviewed);
  const canReject = editable && validClassification && validNote;
  const media = candidate.payload.media;
  const statusName =
    candidate.status === "approved"
      ? "معتمد"
      : candidate.status === "rejected"
        ? "مرفوض"
        : candidate.status === "duplicate"
          ? "مكرّر"
          : "بانتظار المراجعة";
  async function decide(action: "approve" | "reject") {
    setDeciding(true);
    try {
      await onDecide(candidate, action, {
        verificationNote: note.trim(),
        duplicateReviewed,
        difficulty,
        categoryIds,
      });
    } finally {
      setDeciding(false);
    }
  }
  return (
    <article className="rq-card" aria-labelledby={`${fieldId}-question`}>
      <header className="rq-card-header">
        <span className={`rq-status rq-status-${candidate.status}`}>
          {statusName}
        </span>
        <span className="rq-format">
          {formatLabels[candidate.payload.format] || "نوع غير محدد"}
        </span>
        {editable && (
          <button
            type="button"
            className="rq-edit"
            disabled={disabled}
            onClick={() => onEdit(candidate)}
          >
            <FilePenLine size={17} />
            تعديل المسودة
          </button>
        )}
      </header>
      <h2 id={`${fieldId}-question`} className="rq-question">
        {candidate.payload.text}
      </h2>
      {media &&
        ["image", "audio", "video"].includes(candidate.payload.format) && (
          <figure className="rq-media">
            {candidate.payload.format === "image" ? (
              <img
                src={`/api/admin/media/${encodeURIComponent(media.assetId)}`}
                alt={media.alt}
                loading="lazy"
              />
            ) : candidate.payload.format === "audio" ? (
              <audio
                controls
                preload="none"
                aria-label={media.alt}
                src={`/api/admin/media/${encodeURIComponent(media.assetId)}`}
              />
            ) : (
              <video
                controls
                playsInline
                preload="none"
                aria-label={media.alt}
                src={`/api/admin/media/${encodeURIComponent(media.assetId)}`}
              />
            )}
            {(media.transcript || media.alt) && (
              <figcaption>{media.transcript || media.alt}</figcaption>
            )}
            {media.credit && (
              <small>
                إعداد: {media.credit}
                {media.license ? ` · ${media.license}` : ""}
              </small>
            )}
          </figure>
        )}
      <div className="rq-answer">
        <span>الإجابة الصحيحة</span>
        <strong>{candidate.payload.answer}</strong>
      </div>
      {candidate.payload.aliases?.length ? (
        <p className="rq-supporting">
          إجابات مقبولة أيضًا: {candidate.payload.aliases.join("، ")}
        </p>
      ) : null}
      {candidate.payload.options?.length ? (
        <div className="rq-options">
          <span>
            {candidate.payload.format === "ordering"
              ? "العناصر المعروضة"
              : "الخيارات"}
          </span>
          <ul>
            {candidate.payload.options.map((option, i) => (
              <li key={`${option}-${i}`}>{option}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {candidate.payload.orderingAnswer?.length ? (
        <p className="rq-supporting">
          الترتيب الصحيح: {candidate.payload.orderingAnswer.join(" ← ")}
        </p>
      ) : null}
      <p className="rq-explanation">{candidate.payload.explanation}</p>

      {editable ? (
        <fieldset className="rq-classification" disabled={disabled}>
          <legend>حدّد الفئة والصعوبة قبل اتخاذ القرار</legend>
          <div className="rq-classification-fields">
            <label htmlFor={`${fieldId}-category`}>
              الفئة الأساسية
              <select
                id={`${fieldId}-category`}
                value={primaryCategory}
                onChange={(event) => {
                  setPrimaryCategory(event.target.value);
                  setExtraCategories((current) =>
                    current.filter((id) => id !== event.target.value),
                  );
                }}
                required
              >
                <option value="">اختر الفئة</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${fieldId}-difficulty`}>
              مستوى الصعوبة
              <select
                id={`${fieldId}-difficulty`}
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(event.target.value as Difficulty)
                }
                required
              >
                <option value="">اختر المستوى</option>
                {levels.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="rq-extra-categories">
            <summary>
              فئات إضافية، عند الحاجة
              {extraCategories.length ? ` (${extraCategories.length})` : ""}
            </summary>
            <p>يمكن إسناد السؤال إلى خمس فئات كحد أقصى.</p>
            <div className="rq-category-checks">
              {categories
                .filter((category) => category.id !== primaryCategory)
                .map((category) => (
                  <label key={category.id}>
                    <input
                      type="checkbox"
                      checked={extraCategories.includes(category.id)}
                      disabled={
                        !extraCategories.includes(category.id) &&
                        categoryIds.length >= 5
                      }
                      onChange={(event) =>
                        setExtraCategories((current) =>
                          event.target.checked
                            ? [...current, category.id]
                            : current.filter((id) => id !== category.id),
                        )
                      }
                    />
                    {category.name}
                  </label>
                ))}
            </div>
          </details>
        </fieldset>
      ) : (
        <div className="rq-history-classification">
          <span>
            {
              levels.find(
                ([value]) => value === candidate.payload.difficulty,
              )?.[1]
            }
          </span>
          {candidate.payload.categoryIds.map((id) => (
            <span key={id}>
              {categories.find((category) => category.id === id)?.name || id}
            </span>
          ))}
        </div>
      )}

      {candidate.payload.sources?.length ||
      candidate.payload.deterministic ||
      candidate.payload.evidenceKind === "original" ? (
        <details className="rq-evidence">
          <summary>المصادر وطريقة التحقّق</summary>
          {candidate.payload.sources?.map((source, i) => (
            <p key={`${source.url}-${i}`}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.url}
              </a>
              <br />
              {source.citation}
            </p>
          ))}
          {(candidate.payload.deterministic ||
            candidate.payload.evidenceKind === "original") && (
            <p>
              {candidate.payload.evidenceKind === "original"
                ? "طريقة التحقّق من المحتوى الأصلي:"
                : "دليل يمكن التحقّق منه:"}{" "}
              {candidate.payload.fact}
            </p>
          )}
          {candidate.payload.evidenceKind === "original" &&
            candidate.payload.provenance && (
              <p>إعداد المحتوى: {candidate.payload.provenance}</p>
            )}
        </details>
      ) : editable ? (
        <p className="rq-caution">
          أضف مصدرًا موثوقًا أو دليلًا يمكن التحقّق منه في المسودة قبل اعتماد
          السؤال.
        </p>
      ) : null}

      {matches.length > 0 && (
        <div className="rq-matches">
          <details>
            <summary>أسئلة مشابهة تحتاج المقارنة ({matches.length})</summary>
            <ul>
              {matches.map((match) => (
                <li key={match.id}>
                  <strong>{match.text}</strong>
                  <span>الإجابة: {match.answer}</span>
                </li>
              ))}
            </ul>
          </details>
          {candidate.status === "review" && (
            <label className="rq-inline-check">
              <input
                type="checkbox"
                checked={duplicateReviewed}
                disabled={disabled}
                onChange={(event) => setDuplicateReviewed(event.target.checked)}
              />
              راجعت الأسئلة المشابهة، وتحقّقت أن هذا السؤال لا يكرّر سؤالًا آخر.
            </label>
          )}
        </div>
      )}

      {editable ? (
        <div className="rq-review-controls">
          {candidate.status === "duplicate" && (
            <p className="rq-caution">
              رُصد تكرار لهذا السؤال، لذلك لا يمكن اعتماده بصيغته الحالية. عدّل
              المسودة إن كانت تختبر معلومة مختلفة، أو ارفضها إن كانت مكرّرة.
            </p>
          )}
          <label htmlFor={`${fieldId}-note`}>
            ملاحظات المراجعة لهذا السؤال
            <textarea
              id={`${fieldId}-note`}
              value={note}
              maxLength={2000}
              minLength={12}
              disabled={disabled}
              onChange={(event) => setNote(event.target.value)}
              placeholder="مصدر الإجابة، طريقة التحقّق، وسبب قبول السؤال أو رفضه…"
              aria-describedby={`${fieldId}-note-help`}
            />
          </label>
          <small id={`${fieldId}-note-help`}>
            اكتب 12 حرفًا على الأقل. تُحفظ الملاحظة مع قرارك في سجل المراجعة.
          </small>
          <div className="rq-card-actions">
            {candidate.status === "review" && (
              <button
                type="button"
                className="button"
                disabled={disabled || !canApprove}
                onClick={() => void decide("approve")}
              >
                <Check size={18} />
                اعتماد السؤال
              </button>
            )}
            <button
              type="button"
              className="button secondary rq-reject"
              disabled={disabled || !canReject}
              onClick={() => void decide("reject")}
            >
              <X size={18} />
              رفض السؤال
            </button>
          </div>
        </div>
      ) : candidate.verification_note || candidate.reason ? (
        <p className="rq-history-note">
          <strong>ملاحظة المراجعة:</strong>{" "}
          {candidate.verification_note || candidate.reason}
        </p>
      ) : null}
    </article>
  );
}

export function ReviewQueue({
  categories,
  run,
  busy,
  confirm,
  onChanged,
  onEdit,
}: Props) {
  const [status, setStatus] = useState<ReviewStatus>("review");
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestNumber = useRef(0);
  const params = new URLSearchParams({ status, page: String(page) });
  if (categoryId) params.set("categoryId", categoryId);
  if (difficulty) params.set("difficulty", difficulty);
  const query = params.toString();
  const load = useCallback(async () => {
    const requestId = ++requestNumber.current;
    setLoading(true);
    setError("");
    try {
      const next = await request<QueueResponse>(`/admin/review-queue?${query}`);
      if (requestId !== requestNumber.current) return;
      if (next.totalPages > 0 && page > next.totalPages) {
        setPage(next.totalPages);
        return;
      }
      setData(next);
      setLoadedQuery(query);
    } catch (cause) {
      if (requestId === requestNumber.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "تعذّر تحميل قائمة المراجعة.",
        );
    } finally {
      if (requestId === requestNumber.current) setLoading(false);
    }
  }, [page, query]);
  useEffect(() => {
    void load();
    return () => {
      requestNumber.current += 1;
    };
  }, [load]);
  const visibleItems = loadedQuery === query ? data?.items || [] : [];
  const counts = data?.counts || emptyCounts;
  const filtersActive = Boolean(categoryId || difficulty);
  const decision: Parameters<typeof ReviewCard>[0]["onDecide"] = async (
    candidate,
    action,
    values,
  ) => {
    await run(async () => {
      if (
        action === "approve" &&
        !(await confirm(
          "اعتماد هذا السؤال وإتاحته للعب؟ تحقّق من الإجابة والمصادر والفئة والصعوبة قبل التأكيد.",
        ))
      )
        return;
      await request(
        `/admin/candidates/${encodeURIComponent(candidate.id)}/review`,
        { action, ...values, expectedRevision: candidate.revision },
      );
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== candidate.id),
              total: Math.max(0, current.total - 1),
              counts: {
                ...current.counts,
                [candidate.status]: Math.max(
                  0,
                  current.counts[candidate.status] - 1,
                ),
                [action === "approve" ? "approved" : "rejected"]:
                  current.counts[
                    action === "approve" ? "approved" : "rejected"
                  ] + 1,
              },
            }
          : current,
      );
      setNotice(
        action === "approve"
          ? "تم اعتماد السؤال وإزالته من قائمة الانتظار. يمكنك العثور عليه في المعتمدة."
          : "تم رفض السؤال وإزالته من قائمة الانتظار.",
      );
      await Promise.all([load(), onChanged()]);
    });
  };
  function changeView(next: ReviewStatus) {
    setStatus(next);
    setPage(1);
    setNotice("");
  }
  return (
    <section className="rq" aria-label="قائمة مراجعة الأسئلة">
      <header className="rq-heading">
        <div>
          <h2>مراجعة الأسئلة</h2>
          <p>
            حدّد الفئة والصعوبة، ثم راجع الإجابة والمصادر. يغادر السؤال قائمة
            الانتظار فور اعتمادك أو رفضك له.
          </p>
        </div>
        <ShieldCheck size={30} aria-hidden="true" />
      </header>
      <nav className="rq-tabs" aria-label="حالة مراجعة الأسئلة">
        {views.map(([value, name]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={status === value}
            className={status === value ? "chosen" : ""}
            onClick={() => changeView(value)}
          >
            {name}
            <span>{counts[value]}</span>
          </button>
        ))}
      </nav>
      <div className="rq-filters">
        <label>
          تصفية حسب الفئة
          <select
            value={categoryId}
            disabled={busy}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الفئات</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          تصفية حسب الصعوبة
          <select
            value={difficulty}
            disabled={busy}
            onChange={(event) => {
              setDifficulty(event.target.value);
              setPage(1);
            }}
          >
            <option value="">كل المستويات</option>
            {levels.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button secondary rq-refresh"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          <RefreshCw size={18} />
          تحديث القائمة
        </button>
      </div>
      <p className="rq-notice" role="status">
        {notice}
      </p>
      {error && (
        <div className="rq-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      <div className="rq-list" aria-busy={loading}>
        {visibleItems.map((candidate) => (
          <ReviewCard
            key={`${candidate.id}:${candidate.revision}`}
            candidate={candidate}
            categories={categories}
            busy={busy}
            onEdit={onEdit}
            onDecide={decision}
          />
        ))}
      </div>
      {loading && !visibleItems.length && (
        <p className="rq-empty" role="status">
          جارٍ تحميل الأسئلة…
        </p>
      )}
      {!loading && !error && !visibleItems.length && (
        <div className="rq-empty">
          <Check size={28} aria-hidden="true" />
          <h3>
            {filtersActive
              ? "لا توجد أسئلة تطابق هذه التصفية"
              : status === "review"
                ? "قائمة الانتظار فارغة"
                : "لا توجد أسئلة في هذه القائمة"}
          </h3>
          <p>
            {filtersActive
              ? "غيّر الفئة أو مستوى الصعوبة لعرض بقية الأسئلة."
              : status === "review"
                ? "ستظهر هنا الأسئلة الجديدة بعد إضافتها أو اقتراحها. يمكنك مراجعة الأسئلة التي تحتاج فحص التشابه في قائمتها."
                : "اختر قائمة أخرى، أو أضف أسئلة جديدة للمراجعة."}
          </p>
          {filtersActive && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setCategoryId("");
                setDifficulty("");
                setPage(1);
              }}
            >
              إزالة التصفية
            </button>
          )}
        </div>
      )}
      {loadedQuery === query && data && data.totalPages > 1 && (
        <nav className="rq-pagination" aria-label="صفحات قائمة المراجعة">
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading || page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            <ChevronRight size={18} />
            السابق
          </button>
          <span>
            صفحة {data.page} من {data.totalPages}
            <small>{data.total} سؤالًا</small>
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading || page >= data.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            التالي
            <ChevronLeft size={18} />
          </button>
        </nav>
      )}
    </section>
  );
}
