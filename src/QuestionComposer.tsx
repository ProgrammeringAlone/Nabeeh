import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  FileText,
  Image,
  Library,
  Link2,
  Music2,
  Plus,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import "./question-composer.css";

type QuestionFormat = "text" | "image" | "audio" | "video";
type Asset = {
  id: string;
  mime: string;
  credit: string;
  license: string;
  source?: string | null;
  sizeBytes?: number;
};
type Source = { url: string; citation: string };
export type QuestionComposerProps = {
  categories: { id: string; name: string }[];
  initialTarget?: {
    categoryIds?: string[];
    difficulty?: string;
    format?: string;
    region?: string;
  } | null;
  onSubmitted: () => Promise<void> | void;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
};
const formats = [
  {
    id: "text",
    title: "نص",
    description: "سؤال مكتوب وإجابة واضحة",
    icon: FileText,
  },
  {
    id: "image",
    title: "صورة",
    description: "صورة تساعد على حل السؤال",
    icon: Image,
  },
  {
    id: "audio",
    title: "صوت",
    description: "مقطع يستمع إليه اللاعب",
    icon: Music2,
  },
  {
    id: "video",
    title: "فيديو",
    description: "مقطع يشاهده اللاعب",
    icon: Clapperboard,
  },
] as const;
const acceptedTypes: Record<Exclude<QuestionFormat, "text">, string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  audio: ["audio/wav", "audio/x-wav", "audio/ogg", "audio/mpeg"],
  video: ["video/mp4", "video/webm"],
};
const typeHints = {
  image: "PNG أو JPG أو WebP",
  audio: "WAV أو OGG أو MP3",
  video: "MP4 أو WebM",
};
const maxBytes = 10 * 1024 * 1024;
const initialSources = (): Source[] => [{ url: "", citation: "" }];
const list = (value: string) => [
  ...new Set(
    value
      .split(/[,،\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
const message = (error: unknown) =>
  error instanceof Error ? error.message : "تعذّر حفظ السؤال. حاول مرة أخرى.";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message || "تعذّر إكمال الطلب. حاول مرة أخرى.");
  return data;
}

export default function QuestionComposer({
  categories,
  initialTarget,
  onSubmitted,
  onError,
  onSuccess,
}: QuestionComposerProps) {
  const id = useId(),
    fileInput = useRef<HTMLInputElement>(null),
    errorRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState<QuestionFormat | null>(null);
  const [text, setText] = useState(""),
    [answer, setAnswer] = useState(""),
    [explanation, setExplanation] = useState(""),
    [hint, setHint] = useState("");
  const [categoryId, setCategoryId] = useState(""),
    [difficulty, setDifficulty] = useState(""),
    [region, setRegion] = useState("all");
  const [aliases, setAliases] = useState(""),
    [tags, setTags] = useState("");
  const [evidenceKind, setEvidenceKind] = useState<"factual" | "original">(
      "factual",
    ),
    [sources, setSources] = useState(initialSources),
    [fact, setFact] = useState(""),
    [provenance, setProvenance] = useState("");
  const [mediaMode, setMediaMode] = useState<"upload" | "library">("upload"),
    [file, setFile] = useState<File | null>(null),
    [previewUrl, setPreviewUrl] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]),
    [asset, setAsset] = useState<Asset | null>(null),
    [uploadedAsset, setUploadedAsset] = useState<Asset | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false),
    [assetsError, setAssetsError] = useState("");
  const [credit, setCredit] = useState(""),
    [rights, setRights] = useState<"original" | "licensed">("original"),
    [license, setLicense] = useState(""),
    [mediaSource, setMediaSource] = useState("");
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false),
    [alt, setAlt] = useState(""),
    [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState<"uploading" | "submitting" | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [dragging, setDragging] = useState(false);
  const isMedia = format !== null && format !== "text";
  const selectedAsset = mediaMode === "library" ? asset : uploadedAsset;
  const mediaUrl =
    mediaMode === "library"
      ? asset
        ? `/api/admin/media/${asset.id}`
        : ""
      : previewUrl;

  useEffect(() => {
    if (!initialTarget) return;
    setCategoryId(initialTarget.categoryIds?.[0] || "");
    setDifficulty(initialTarget.difficulty || "");
    setRegion(initialTarget.region || "all");
    const chosenFormat =
      formats.find((item) => item.id === initialTarget.format)?.id || null;
    setFormat(chosenFormat);
    setPreviewUrl("");
    setFile(null);
    setAsset(null);
    setUploadedAsset(null);
    setAlt("");
    setTranscript("");
    setError("");
    setSuccess("");
  }, [initialTarget]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!format || format === "text" || mediaMode !== "library") return;
    const controller = new AbortController();
    setAssetsLoading(true);
    setAssetsError("");
    setAssets([]);
    request<{ assets: Asset[] }>(
      `/api/admin/media?format=${format}&limit=100`,
      { signal: controller.signal },
    )
      .then((data) => setAssets(data.assets))
      .catch((e) => {
        if (!controller.signal.aborted) setAssetsError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setAssetsLoading(false);
      });
    return () => controller.abort();
  }, [format, mediaMode]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function reportError(value: string) {
    setError(value);
    setSuccess("");
    onError?.(value);
  }
  function chooseFormat(value: QuestionFormat) {
    if (format !== value) {
      // Remove the old media element before its object URL is revoked by effect cleanup.
      setPreviewUrl("");
      setFile(null);
      setAsset(null);
      setUploadedAsset(null);
      setAlt("");
      setTranscript("");
    }
    setFormat(value);
    setError("");
    setSuccess("");
  }
  function chooseFile(value?: File) {
    if (!value || !format || format === "text") return;
    if (!acceptedTypes[format].includes(value.type)) {
      reportError(`اختر ملفًا من الأنواع المسموحة: ${typeHints[format]}.`);
      return;
    }
    if (!value.size || value.size > maxBytes) {
      reportError("اختر ملفًا غير فارغ لا يتجاوز حجمه 10 ميغابايت.");
      return;
    }
    if (file !== value) setPreviewUrl("");
    setFile(value);
    setUploadedAsset(null);
    setAsset(null);
    setError("");
    setSuccess("");
  }
  function reset() {
    setFormat(null);
    setText("");
    setAnswer("");
    setExplanation("");
    setHint("");
    setCategoryId("");
    setDifficulty("");
    setRegion("all");
    setAliases("");
    setTags("");
    setEvidenceKind("factual");
    setSources(initialSources());
    setFact("");
    setProvenance("");
    setMediaMode("upload");
    setPreviewUrl("");
    setFile(null);
    setAsset(null);
    setUploadedAsset(null);
    setCredit("");
    setRights("original");
    setLicense("");
    setMediaSource("");
    setOwnershipConfirmed(false);
    setAlt("");
    setTranscript("");
    if (fileInput.current) fileInput.current.value = "";
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !format) return;
    setError("");
    setSuccess("");
    if (!categoryId || !difficulty) {
      reportError("حدّد فئة السؤال ومستوى صعوبته قبل إرساله.");
      return;
    }
    if (list(aliases).length > 20 || list(tags).length > 12) {
      reportError("يمكن إضافة 20 إجابة بديلة و12 وسمًا كحد أقصى.");
      return;
    }
    if (list(aliases).some((value) => value.length > 300)) {
      reportError("يجب ألا تتجاوز الإجابة البديلة 300 حرف.");
      return;
    }
    if (isMedia && !selectedAsset && !file) {
      reportError("اختر ملف الوسائط أو ملفًا محفوظًا في المكتبة.");
      return;
    }
    if (isMedia && mediaMode === "library" && !asset) {
      reportError("اختر ملفًا من مكتبة الوسائط.");
      return;
    }
    setBusy(true);
    let saved = false;
    try {
      let mediaId = selectedAsset?.id;
      if (isMedia && mediaMode === "upload" && !mediaId && file) {
        setStage("uploading");
        const mediaLicense =
          rights === "original"
            ? "عمل أصلي — بإذن صاحب الحقوق للاستخدام في نبيه"
            : license.trim();
        const headers: Record<string, string> = {
          "Content-Type": file.type === "audio/x-wav" ? "audio/wav" : file.type,
          "X-Nabeeh-Request": "1",
          "X-Media-Credit": encodeURIComponent(credit.trim()),
          "X-Media-License": encodeURIComponent(mediaLicense),
        };
        if (mediaSource.trim())
          headers["X-Media-Source"] = encodeURIComponent(mediaSource.trim());
        const uploaded = await request<{
          id: string;
          mime: string;
          sizeBytes: number;
        }>("/api/admin/media", { method: "POST", headers, body: file });
        const kept = {
          ...uploaded,
          credit: credit.trim(),
          license: mediaLicense,
          source: mediaSource.trim() || null,
        };
        setUploadedAsset(kept);
        mediaId = uploaded.id;
      }
      setStage("submitting");
      await request("/api/admin/submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nabeeh-Request": "1",
        },
        body: JSON.stringify({
          text: text.trim(),
          answer: answer.trim(),
          explanation: explanation.trim(),
          hint: hint.trim(),
          categoryIds: [categoryId],
          difficulty,
          format,
          region,
          aliases: list(aliases),
          tags: list(tags),
          sources:
            evidenceKind === "factual"
              ? sources.map((s) => ({
                  url: s.url.trim(),
                  citation: s.citation.trim(),
                }))
              : [],
          provenance: provenance.trim(),
          evidenceKind,
          ...(evidenceKind === "original" && fact.trim()
            ? { fact: fact.trim() }
            : {}),
          ...(isMedia
            ? {
                media: {
                  assetId: mediaId,
                  alt: alt.trim(),
                  ...(transcript.trim()
                    ? { transcript: transcript.trim() }
                    : {}),
                },
              }
            : {}),
        }),
      });
      saved = true;
      reset();
      const confirmation =
        "تم حفظ السؤال وفحص التشابه. راجعه في قائمة المراجعة قبل نشره.";
      setSuccess(confirmation);
      onSuccess?.(confirmation);
    } catch (e) {
      reportError(message(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
    if (saved) {
      try {
        await onSubmitted();
      } catch (e) {
        reportError(
          `تم حفظ السؤال، لكن تعذّر تحديث قائمة المراجعة. ${message(e)}`,
        );
      }
    }
  }

  return (
    <form
      className="question-composer"
      onSubmit={submit}
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <div className="qc-heading">
        <span className="qc-eyebrow">
          <Plus size={16} aria-hidden="true" /> سؤال جديد
        </span>
        <h2 id={`${id}-title`}>أضف سؤالًا بطريقتك</h2>
        <p>
          اختر نوع السؤال، وحدّد فئته ومستواه. يبقى خارج اللعب حتى يراجعه محرّر
          ويعتمده.
        </p>
      </div>
      {error && (
        <div
          className="qc-message qc-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {error}
        </div>
      )}
      {success && (
        <div className="qc-message qc-success" role="status">
          <CheckCircle2 size={20} aria-hidden="true" />
          {success}
        </div>
      )}
      <fieldset className="qc-type-fieldset" disabled={busy}>
        <legend>
          <span className="qc-step">1</span> ابدأ بنوع السؤال
        </legend>
        <div className="qc-types">
          {formats.map(({ id: value, title, description, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className={`qc-type ${format === value ? "selected" : ""}`}
              aria-pressed={format === value}
              onClick={() => chooseFormat(value)}
            >
              <span className="qc-type-icon">
                <Icon size={26} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <strong>{title}</strong>
              <span>{description}</span>
              {format === value && (
                <CheckCircle2
                  className="qc-type-check"
                  size={19}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
      </fieldset>
      {format && (
        <fieldset className="qc-content-fieldset" disabled={busy}>
          <div className="qc-section">
            <h3>
              <span className="qc-step">2</span> محتوى السؤال
            </h3>
            {isMedia && (
              <div className="qc-media-box">
                <div
                  className="qc-media-tabs"
                  role="group"
                  aria-label="مصدر ملف الوسائط"
                >
                  <button
                    type="button"
                    aria-pressed={mediaMode === "upload"}
                    className={mediaMode === "upload" ? "selected" : ""}
                    onClick={() => setMediaMode("upload")}
                  >
                    <UploadCloud size={17} aria-hidden="true" /> رفع ملف
                  </button>
                  <button
                    type="button"
                    aria-pressed={mediaMode === "library"}
                    className={mediaMode === "library" ? "selected" : ""}
                    onClick={() => setMediaMode("library")}
                  >
                    <Library size={17} aria-hidden="true" /> من مكتبة الوسائط
                  </button>
                </div>
                {mediaMode === "upload" ? (
                  <>
                    <input
                      className="qc-file-input"
                      ref={fileInput}
                      type="file"
                      tabIndex={-1}
                      id={`${id}-file`}
                      aria-label="اختر ملف الوسائط"
                      accept={acceptedTypes[
                        format as Exclude<QuestionFormat, "text">
                      ].join(",")}
                      onChange={(event) => {
                        chooseFile(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                    <div
                      className={`qc-dropzone ${dragging ? "dragging" : ""}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (!busy) setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        if (!busy && event.dataTransfer.files.length > 1)
                          reportError("اختر ملفًا واحدًا لكل سؤال.");
                        else if (!busy) chooseFile(event.dataTransfer.files[0]);
                      }}
                    >
                      <UploadCloud
                        size={34}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <strong>
                        {file ? file.name : "اسحب الملف هنا أو اختره من جهازك"}
                      </strong>
                      <span>
                        {file
                          ? `${(file.size / 1024 / 1024).toFixed(2)} ميغابايت`
                          : `${typeHints[format as Exclude<QuestionFormat, "text">]} · حتى 10 ميغابايت`}
                      </span>
                      <button
                        type="button"
                        className="qc-button qc-secondary"
                        onClick={() => fileInput.current?.click()}
                      >
                        {file ? "تغيير الملف" : "اختيار ملف"}
                      </button>
                    </div>
                    {uploadedAsset && (
                      <p className="qc-upload-kept">
                        <CheckCircle2 size={17} aria-hidden="true" /> الملف
                        محفوظ. إعادة إرسال السؤال لن ترفع الملف مرة أخرى.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="qc-library-picker">
                    {assetsLoading ? (
                      <p role="status">جارٍ تحميل مكتبة الوسائط…</p>
                    ) : assetsError ? (
                      <p role="alert">{assetsError}</p>
                    ) : assets.length ? (
                      <label htmlFor={`${id}-asset`}>
                        الملف المحفوظ
                        <select
                          id={`${id}-asset`}
                          value={asset?.id || ""}
                          required
                          onChange={(event) => {
                            setAsset(
                              assets.find((a) => a.id === event.target.value) ||
                                null,
                            );
                            setError("");
                          }}
                        >
                          <option value="">اختر ملفًا</option>
                          {assets.map((a, index) => (
                            <option key={a.id} value={a.id}>
                              {a.credit} · {a.mime.split("/")[1].toUpperCase()}{" "}
                              · الملف {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p>
                        لا توجد ملفات من هذا النوع بعد. اختر «رفع ملف» لإضافة
                        ملف جديد.
                      </p>
                    )}
                    {asset && (
                      <p className="qc-asset-credit">
                        {asset.credit} · {asset.license}
                        {asset.source && (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={asset.source}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              مصدر الملف
                            </a>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                )}
                {mediaUrl && (
                  <figure className="qc-preview">
                    {format === "image" ? (
                      <img
                        src={mediaUrl}
                        alt={alt.trim() || "معاينة الصورة المرفقة بالسؤال"}
                      />
                    ) : format === "audio" ? (
                      <audio
                        controls
                        preload="metadata"
                        aria-label="معاينة المقطع الصوتي"
                        src={mediaUrl}
                      />
                    ) : (
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        aria-label="معاينة الفيديو"
                        src={mediaUrl}
                      />
                    )}
                    <figcaption>معاينة الملف قبل إرساله</figcaption>
                  </figure>
                )}
                <label htmlFor={`${id}-alt`}>
                  وصف الوسائط
                  <input
                    id={`${id}-alt`}
                    value={alt}
                    onChange={(event) => setAlt(event.target.value)}
                    required
                    minLength={5}
                    maxLength={500}
                    placeholder={
                      format === "image"
                        ? "صف العناصر المهمة لفهم الصورة"
                        : "وصف موجز لما يحتويه المقطع"
                    }
                  />
                  <small>اكتب وصفًا واضحًا يساعد من يستخدم قارئ الشاشة.</small>
                </label>
                {(format === "audio" || format === "video") && (
                  <label htmlFor={`${id}-transcript`}>
                    النص البديل للمقطع
                    <textarea
                      id={`${id}-transcript`}
                      value={transcript}
                      onChange={(event) => setTranscript(event.target.value)}
                      required
                      minLength={5}
                      maxLength={2000}
                      placeholder="اكتب الكلام المسموع ووصف الأحداث أو الأصوات المهمة للسؤال"
                    />
                    <small>
                      يتيح فهم السؤال لمن لا يستطيع سماع المقطع أو مشاهدته.
                    </small>
                  </label>
                )}
                {mediaMode === "upload" && (
                  <div className="qc-rights">
                    <h4>
                      <ShieldCheck size={17} aria-hidden="true" /> حقوق استخدام
                      الملف
                    </h4>
                    <div className="qc-grid">
                      <label htmlFor={`${id}-rights`}>
                        مصدر الحقوق
                        <select
                          id={`${id}-rights`}
                          value={rights}
                          disabled={!!uploadedAsset || busy}
                          onChange={(event) => {
                            setRights(
                              event.target.value as "original" | "licensed",
                            );
                            setOwnershipConfirmed(false);
                          }}
                        >
                          <option value="original">ملف أصلي أملك حقوقه</option>
                          <option value="licensed">
                            ملف لدي إذن أو ترخيص باستخدامه
                          </option>
                        </select>
                      </label>
                      <label htmlFor={`${id}-credit`}>
                        صاحب المحتوى أو اسم الجهة المنتجة
                        <input
                          id={`${id}-credit`}
                          value={credit}
                          disabled={!!uploadedAsset || busy}
                          onChange={(event) => setCredit(event.target.value)}
                          required
                          minLength={3}
                          maxLength={500}
                          placeholder="اسم المصوّر، المؤلف، أو الجهة"
                        />
                      </label>
                    </div>
                    {rights === "licensed" && (
                      <div className="qc-grid">
                        <label htmlFor={`${id}-license`}>
                          الترخيص أو وصف الإذن
                          <input
                            id={`${id}-license`}
                            value={license}
                            disabled={!!uploadedAsset || busy}
                            onChange={(event) => setLicense(event.target.value)}
                            required
                            minLength={3}
                            maxLength={500}
                            placeholder="مثل CC BY 4.0، أو إذن كتابي من صاحب الحقوق"
                          />
                        </label>
                        <label htmlFor={`${id}-media-source`}>
                          رابط مصدر الملف
                          <input
                            id={`${id}-media-source`}
                            type="url"
                            dir="ltr"
                            value={mediaSource}
                            disabled={!!uploadedAsset || busy}
                            onChange={(event) =>
                              setMediaSource(event.target.value)
                            }
                            required
                            pattern="https://.*"
                            maxLength={2000}
                            placeholder="https://…"
                          />
                        </label>
                      </div>
                    )}
                    <label className="qc-check">
                      <input
                        type="checkbox"
                        checked={ownershipConfirmed}
                        onChange={(event) =>
                          setOwnershipConfirmed(event.target.checked)
                        }
                        required
                      />{" "}
                      أؤكد أن لدي حق نشر هذا الملف واستخدامه في اللعبة.
                    </label>
                  </div>
                )}
              </div>
            )}
            <label htmlFor={`${id}-text`}>
              نص السؤال
              <textarea
                id={`${id}-text`}
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
                minLength={8}
                maxLength={600}
                placeholder="اكتب سؤالًا مباشرًا لا يحتمل أكثر من تفسير"
              />
            </label>
            <div className="qc-grid">
              <label htmlFor={`${id}-answer`}>
                الإجابة الصحيحة
                <input
                  id={`${id}-answer`}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  required
                  maxLength={300}
                  placeholder="الإجابة الأساسية"
                />
              </label>
              <label htmlFor={`${id}-hint`}>
                تلميح مساعد
                <input
                  id={`${id}-hint`}
                  value={hint}
                  onChange={(event) => setHint(event.target.value)}
                  required
                  minLength={2}
                  maxLength={300}
                  placeholder="يساعد على الحل دون كشف الإجابة"
                />
              </label>
            </div>
            <label htmlFor={`${id}-explanation`}>
              شرح الإجابة
              <textarea
                id={`${id}-explanation`}
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
                required
                minLength={8}
                maxLength={2000}
                placeholder="اشرح لماذا هذه الإجابة صحيحة"
              />
            </label>
          </div>
          <div className="qc-section">
            <h3>
              <span className="qc-step">3</span> الفئة ومستوى الصعوبة
            </h3>
            <p className="qc-section-description">
              اخترهما بنفسك. يستطيع المحرّر تعديلهما أثناء المراجعة قبل اتخاذ
              القرار.
            </p>
            <div className="qc-grid">
              <label htmlFor={`${id}-category`}>
                فئة السؤال
                <select
                  id={`${id}-category`}
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  required
                >
                  <option value="">اختر الفئة</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`${id}-difficulty`}>
                مستوى الصعوبة
                <select
                  id={`${id}-difficulty`}
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                  required
                >
                  <option value="">اختر المستوى</option>
                  <option value="easy">سهل</option>
                  <option value="medium">متوسط</option>
                  <option value="hard">صعب</option>
                  <option value="expert">خبير</option>
                </select>
              </label>
            </div>
            <label className="qc-region" htmlFor={`${id}-region`}>
              المنطقة المرتبطة بالسؤال
              <select
                id={`${id}-region`}
                value={region}
                onChange={(event) => setRegion(event.target.value)}
              >
                <option value="all">عام — لا يرتبط بمنطقة محددة</option>
                <option value="sa">السعودية</option>
                <option value="kw">الكويت</option>
                <option value="ae">الإمارات</option>
                <option value="bh">البحرين</option>
                <option value="qa">قطر</option>
                <option value="om">عُمان</option>
              </select>
            </label>
          </div>
          <div className="qc-section">
            <h3>
              <span className="qc-step">4</span> ما يدعم صحة السؤال
            </h3>
            <p className="qc-section-description">
              المراجع أو طريقة الحل تساعد المحرّر على التحقّق. إضافة مصدر لا
              تعني اعتماد السؤال تلقائيًا.
            </p>
            <div className="qc-evidence-options">
              <label className="qc-radio">
                <input
                  type="radio"
                  name={`${id}-evidence-kind`}
                  value="factual"
                  checked={evidenceKind === "factual"}
                  onChange={() => setEvidenceKind("factual")}
                />{" "}
                معلومة تستند إلى مصدر
              </label>
              <label className="qc-radio">
                <input
                  type="radio"
                  name={`${id}-evidence-kind`}
                  value="original"
                  checked={evidenceKind === "original"}
                  onChange={() => setEvidenceKind("original")}
                />{" "}
                لغز أو محتوى أصلي
              </label>
            </div>
            {evidenceKind === "factual" ? (
              <div className="qc-sources">
                {sources.map((source, index) => (
                  <div className="qc-source" key={index}>
                    <div className="qc-source-title">
                      <strong>
                        <Link2 size={16} aria-hidden="true" /> المصدر{" "}
                        {index + 1}
                      </strong>
                      {sources.length > 1 && (
                        <button
                          type="button"
                          className="qc-icon-button"
                          aria-label={`حذف المصدر ${index + 1}`}
                          onClick={() =>
                            setSources(sources.filter((_, i) => i !== index))
                          }
                        >
                          <X size={18} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <label htmlFor={`${id}-source-${index}`}>
                      رابط المصدر
                      <input
                        id={`${id}-source-${index}`}
                        type="url"
                        dir="ltr"
                        value={source.url}
                        onChange={(event) =>
                          setSources(
                            sources.map((s, i) =>
                              i === index
                                ? { ...s, url: event.target.value }
                                : s,
                            ),
                          )
                        }
                        required
                        pattern="https://.*"
                        maxLength={2000}
                        placeholder="https://…"
                      />
                    </label>
                    <label htmlFor={`${id}-citation-${index}`}>
                      المعلومة أو الفقرة التي تدعم الإجابة
                      <textarea
                        id={`${id}-citation-${index}`}
                        value={source.citation}
                        onChange={(event) =>
                          setSources(
                            sources.map((s, i) =>
                              i === index
                                ? { ...s, citation: event.target.value }
                                : s,
                            ),
                          )
                        }
                        required
                        minLength={5}
                        maxLength={1000}
                        placeholder="حدّد المعلومة، اسم المرجع، أو رقم الصفحة"
                      />
                    </label>
                  </div>
                ))}
                {sources.length < 10 && (
                  <button
                    type="button"
                    className="qc-text-button"
                    onClick={() =>
                      setSources([...sources, { url: "", citation: "" }])
                    }
                  >
                    <Plus size={17} aria-hidden="true" /> إضافة مصدر آخر
                  </button>
                )}
              </div>
            ) : (
              <label htmlFor={`${id}-fact`}>
                طريقة التحقّق أو الحلّ
                <textarea
                  id={`${id}-fact`}
                  value={fact}
                  onChange={(event) => setFact(event.target.value)}
                  required
                  minLength={12}
                  maxLength={1000}
                  placeholder="اكتب خطوات الحل، الحساب، أو وصفًا يتيح التحقّق من الملف والإجابة"
                />
                <small>يظل المحتوى الأصلي بحاجة إلى مراجعة بشرية.</small>
              </label>
            )}
            <label htmlFor={`${id}-provenance`}>
              ملاحظة عن إعداد السؤال
              <textarea
                id={`${id}-provenance`}
                value={provenance}
                onChange={(event) => setProvenance(event.target.value)}
                required
                minLength={12}
                maxLength={500}
                placeholder="كيف أعددت السؤال؟ وما الذي راجعته للتأكد من صحته وأصالته؟"
              />
            </label>
          </div>
          <details className="qc-extras">
            <summary>
              إجابات بديلة ووسوم <span>اختياري</span>
            </summary>
            <div className="qc-grid">
              <label htmlFor={`${id}-aliases`}>
                إجابات بديلة مقبولة
                <textarea
                  id={`${id}-aliases`}
                  value={aliases}
                  onChange={(event) => setAliases(event.target.value)}
                  placeholder="إجابة في كل سطر، أو افصل بينها بفاصلة"
                />
                <small>حتى 20 إجابة، بطول 300 حرف لكل إجابة.</small>
              </label>
              <label htmlFor={`${id}-tags`}>
                وسوم تساعد على تنظيم المحتوى
                <input
                  id={`${id}-tags`}
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  maxLength={600}
                  placeholder="مثل: نباتات، علوم، ملاحظة"
                />
                <small>افصل الوسوم بفاصلة. حتى 12 وسمًا.</small>
              </label>
            </div>
          </details>
          <div className="qc-submit-bar">
            <p>
              <ShieldCheck size={19} aria-hidden="true" /> يُفحص التشابه، ثم
              يقرّر المحرّر اعتماد السؤال أو رفضه.
            </p>
            <button
              className="qc-button"
              type="submit"
              disabled={busy || !categories.length}
            >
              {stage === "uploading"
                ? "جارٍ رفع الملف…"
                : stage === "submitting"
                  ? "جارٍ حفظ السؤال…"
                  : "إرسال السؤال للمراجعة"}
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
          </div>
        </fieldset>
      )}
    </form>
  );
}
