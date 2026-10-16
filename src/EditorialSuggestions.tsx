import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, RefreshCw, Sparkles } from "lucide-react";
import { difficultyLabels, formatLabels, regionLabels } from "./arabic";
import "./editorial-suggestions.css";

type Suggestion = {
  categoryId: string;
  categoryName: string;
  difficulty: string;
  format: string;
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
type SuggestionResponse = {
  suggestions: Suggestion[];
  methodology: string;
  humanAnalysis: {
    approvedQuestions: number;
    categories: { value: string; name: string; count: number }[];
    difficulties: { value: string; count: number }[];
    formats: { value: string; count: number }[];
    regions: { value: string; count: number }[];
    tags: { value: string; count: number }[];
    methodology: string;
  };
  provider: {
    configured: boolean;
    budgetCents: number;
    reservedCents: number;
    canGenerate: boolean;
    modelName: string;
  };
};
export type SuggestedQuestionTarget = {
  categoryIds: string[];
  difficulty: string;
  format: string;
  region: string;
};
type Props = {
  request: (path: string, body?: unknown, method?: string) => Promise<any>;
  onCompose: (target: SuggestedQuestionTarget) => void;
  onReview?: () => void;
  onQueued?: () => void | Promise<void>;
  busy?: boolean;
};

export default function EditorialSuggestions({
  request,
  onCompose,
  onReview,
  onQueued,
  busy,
}: Props) {
  const [data, setData] = useState<SuggestionResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setWorking(true);
    setError("");
    try {
      setData(await request("/admin/suggestions"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذّر تحميل الاقتراحات.",
      );
    } finally {
      setWorking(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const queue = async (suggestion: Suggestion) => {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await request("/admin/jobs", {
        categoryId: suggestion.categoryId,
        kind: suggestion.kind,
        count: suggestion.count,
        difficulty: suggestion.difficulty,
        format: suggestion.format,
        region: suggestion.region,
      });
      setMessage(
        "أُضيفت مهمة اقتراح مسودات. ستظهر النتائج في قائمة المراجعة، ولن تُنشر تلقائيًا.",
      );
      await onQueued?.();
      setData(await request("/admin/suggestions"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذّر إضافة مهمة الاقتراح.",
      );
    } finally {
      setWorking(false);
    }
  };
  const disabled = Boolean(busy || working);
  return (
    <section
      className="editorial-suggestions"
      aria-labelledby="editorial-suggestions-title"
    >
      <div className="editorial-suggestions-heading">
        <div>
          <span className="editorial-suggestions-eyebrow">
            <Sparkles size={17} aria-hidden="true" /> اختيارات المحررين تقود
            الاقتراحات
          </span>
          <h2 id="editorial-suggestions-title">ماذا نضيف إلى المكتبة؟</h2>
        </div>
        <button
          type="button"
          className="editorial-suggestions-refresh"
          disabled={disabled}
          onClick={() => void load()}
        >
          <RefreshCw size={16} aria-hidden="true" /> حدّث الاقتراحات
        </button>
      </div>
      <p className="editorial-suggestions-method">
        {data?.methodology ||
          "نجمع توزيع الأنواع والمستويات والفئات التي اعتمدها المحررون، ثم نقترح ما ينقص المكتبة."}
      </p>
      {error && (
        <p role="alert" className="editorial-suggestions-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="editorial-suggestions-success">
          {message}
        </p>
      )}
      {!data && !error && <p role="status">جارٍ قراءة اختيارات المحررين…</p>}
      {data && (
        <>
          <section
            className="editorial-human-analysis"
            aria-labelledby="editorial-human-analysis-title"
          >
            <div className="editorial-human-analysis-heading">
              <h3 id="editorial-human-analysis-title">تحليل أسئلة المشرفين</h3>
              <span className="editorial-human-origin">المصدر: المشرف</span>
            </div>
            <p className="editorial-human-analysis-count">
              الأسئلة البشرية المعتمدة التي تقود الاقتراحات:{" "}
              <strong>{data.humanAnalysis.approvedQuestions}</strong>
            </p>
            {data.humanAnalysis.approvedQuestions ? (
              <div className="editorial-human-analysis-groups">
                <div>
                  <h4>الفئات</h4>
                  <ul>
                    {data.humanAnalysis.categories.slice(0, 6).map((row) => (
                      <li key={row.value}>
                        {row.name}
                        <b>{row.count}</b>
                      </li>
                    ))}
                  </ul>
                  {data.humanAnalysis.categories.length > 6 && (
                    <small>وفئات أخرى ضمن التحليل</small>
                  )}
                </div>
                <div>
                  <h4>الصعوبة</h4>
                  <ul>
                    {data.humanAnalysis.difficulties.map((row) => (
                      <li key={row.value}>
                        {difficultyLabels[row.value] || row.value}
                        <b>{row.count}</b>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>نوع السؤال</h4>
                  <ul>
                    {data.humanAnalysis.formats.map((row) => (
                      <li key={row.value}>
                        {formatLabels[row.value] || row.value}
                        <b>{row.count}</b>
                      </li>
                    ))}
                  </ul>
                </div>
                {data.humanAnalysis.regions.some(
                  (row) => row.value !== "all",
                ) && (
                  <div>
                    <h4>المناطق</h4>
                    <ul>
                      {data.humanAnalysis.regions.map((row) => (
                        <li key={row.value}>
                          {regionLabels[row.value] || row.value}
                          <b>{row.count}</b>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.humanAnalysis.tags.length > 0 && (
                  <div>
                    <h4>الوسوم الشائعة</h4>
                    <ul>
                      {data.humanAnalysis.tags.map((row) => (
                        <li key={row.value}>
                          {row.value}
                          <b>{row.count}</b>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="editorial-human-analysis-empty">
                أضف أسئلتك ثم اعتمدها من المراجعة. سيظهر توزيعها هنا، وستتحدّث
                الاقتراحات بناءً على اختياراتك.
              </p>
            )}
            <p className="editorial-human-analysis-method">
              {data.humanAnalysis.methodology}
            </p>
          </section>
          <div className="editorial-suggestions-provider">
            <BookOpen size={18} aria-hidden="true" />
            <span>
              {data.provider.canGenerate
                ? "اقتراحات النموذج متاحة ضمن الميزانية المضبوطة. تظل مراجعة المحرر مطلوبة."
                : "الإضافة اليدوية والمولّد الحسابي متاحان الآن. اقتراحات النموذج تحتاج إعداد مزوّد وميزانية في إعدادات الخدمة."}
            </span>
          </div>
          {data.suggestions.length === 0 ? (
            <p className="editorial-suggestions-empty">
              لا توجد فجوات عاجلة في توزيع المستويات حاليًا. يمكنك إضافة أسئلة
              جديدة أو مراجعة المسودات من التبويبات الأخرى.
            </p>
          ) : (
            <div className="editorial-suggestions-grid">
              {data.suggestions.map((suggestion) => {
                const advancedFormat = ["word", "choice", "ordering"].includes(
                  suggestion.format,
                );
                // The label makes this conversion explicit. Advanced formats retain
                // their exact targets for review/model jobs and can also be imported.
                const manualFormat = advancedFormat
                  ? "text"
                  : suggestion.format;
                return (
                  <article
                    className="editorial-suggestion-card"
                    key={`${suggestion.categoryId}:${suggestion.difficulty}:${suggestion.format}:${suggestion.region}`}
                  >
                    <div className="editorial-suggestion-labels">
                      <span>
                        {formatLabels[suggestion.format] || "نوع السؤال"}
                      </span>
                      <span>
                        {difficultyLabels[suggestion.difficulty] ||
                          "مستوى السؤال"}
                      </span>
                      {suggestion.region !== "all" && (
                        <span>
                          {regionLabels[suggestion.region] || "منطقة السؤال"}
                        </span>
                      )}
                    </div>
                    <h3>{suggestion.categoryName}</h3>
                    <p>{suggestion.reason}</p>
                    <dl className="editorial-suggestion-stats">
                      <div>
                        <dt>معتمد بهذه المواصفات</dt>
                        <dd>{suggestion.approvedCount}</dd>
                      </div>
                      <div>
                        <dt>قرارات مراجعة</dt>
                        <dd>{suggestion.reviewCount}</dd>
                      </div>
                      <div>
                        <dt>نسبة الاعتماد</dt>
                        <dd>
                          {suggestion.approvalRate === null
                            ? "—"
                            : `${suggestion.approvalRate}٪`}
                        </dd>
                      </div>
                    </dl>
                    <div className="editorial-suggestion-actions">
                      {suggestion.action === "review" && onReview ? (
                        <button
                          type="button"
                          className="editorial-suggestion-primary"
                          disabled={disabled}
                          onClick={onReview}
                        >
                          راجع {suggestion.pendingCount} مسودات{" "}
                          <ArrowLeft size={16} aria-hidden="true" />
                        </button>
                      ) : suggestion.action === "generate" ? (
                        <button
                          type="button"
                          className="editorial-suggestion-primary"
                          disabled={disabled}
                          onClick={() => void queue(suggestion)}
                        >
                          اقترح {suggestion.count} مسودات{" "}
                          {suggestion.kind === "arithmetic"
                            ? "حسابية"
                            : "بالنموذج"}
                          <Sparkles size={16} aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={
                          suggestion.action === "compose"
                            ? "editorial-suggestion-primary"
                            : "editorial-suggestion-secondary"
                        }
                        disabled={disabled}
                        onClick={() =>
                          onCompose({
                            categoryIds: [suggestion.categoryId],
                            difficulty: suggestion.difficulty,
                            format: manualFormat,
                            region: suggestion.region,
                          })
                        }
                      >
                        {advancedFormat
                          ? "أضف سؤالًا نصيًا في هذه الفئة والمستوى"
                          : "أضف سؤالًا بهذه المواصفات"}{" "}
                        <ArrowLeft size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
