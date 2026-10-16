import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  Image,
  Library,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";

type ImageAsset = {
  id: string;
  mime: string;
  credit: string;
  license: string;
  source?: string | null;
};
export type AnswerImageValue = { assetId: string; alt?: string };
export type AnswerImagePickerHandle = {
  prepare: () => Promise<AnswerImageValue>;
};
const imageTypes = ["image/png", "image/jpeg", "image/webp"];
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "تعذّر رفع صورة الإجابة. حاول مرة أخرى.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message || "تعذّر تحميل صورة الإجابة. حاول مرة أخرى.");
  return data;
}

const AnswerImagePicker = forwardRef<
  AnswerImagePickerHandle,
  { busy: boolean; onError: (message: string) => void }
>(function AnswerImagePicker({ busy, onError }, ref) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"upload" | "library">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [uploaded, setUploaded] = useState<ImageAsset | null>(null);
  const [selected, setSelected] = useState<ImageAsset | null>(null);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [credit, setCredit] = useState("");
  const [rights, setRights] = useState<"original" | "licensed">("original");
  const [license, setLicense] = useState("");
  const [source, setSource] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [alt, setAlt] = useState("");
  const imageUrl =
    mode === "library"
      ? selected
        ? `/api/admin/media/${selected.id}`
        : ""
      : preview;

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (mode !== "library") return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    request<{ assets: ImageAsset[] }>(
      "/api/admin/media?format=image&limit=100",
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!controller.signal.aborted) setAssets(data.assets);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mode, reload]);

  useImperativeHandle(ref, () => ({
    async prepare() {
      let asset = mode === "library" ? selected : uploaded;
      if (!asset) {
        if (mode === "library")
          throw new Error("اختر صورة الإجابة من المكتبة.");
        if (!file) throw new Error("أضف صورة الإجابة قبل إرسال السؤال.");
        if (!confirmed) throw new Error("أكّد حقوق استخدام صورة الإجابة.");
        const mediaLicense =
          rights === "original"
            ? "عمل أصلي — بإذن صاحب الحقوق للاستخدام في نبيه"
            : license.trim();
        const headers: Record<string, string> = {
          "Content-Type": file.type,
          "X-Nabeeh-Request": "1",
          "X-Media-Credit": encodeURIComponent(credit.trim()),
          "X-Media-License": encodeURIComponent(mediaLicense),
        };
        if (source.trim())
          headers["X-Media-Source"] = encodeURIComponent(source.trim());
        const result = await request<{ id: string; mime: string }>(
          "/api/admin/media",
          {
            method: "POST",
            headers,
            body: file,
          },
        );
        asset = {
          ...result,
          credit: credit.trim(),
          license: mediaLicense,
          source: source.trim() || null,
        };
        setUploaded(asset);
      }
      return { assetId: asset.id, ...(alt.trim() ? { alt: alt.trim() } : {}) };
    },
  }));

  function chooseFile(value?: File) {
    if (!value) return;
    if (!imageTypes.includes(value.type)) {
      onError("اختر صورة إجابة بصيغة PNG أو JPG أو WebP.");
      return;
    }
    if (!value.size || value.size > 10 * 1024 * 1024) {
      onError("اختر صورة إجابة غير فارغة لا يتجاوز حجمها 10 ميغابايت.");
      return;
    }
    setPreview("");
    setFile(value);
    setUploaded(null);
  }
  function removeImage() {
    setPreview("");
    setFile(null);
    setUploaded(null);
    setSelected(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div
      className="qc-media-box qc-answer-image"
      data-testid="answer-image-picker"
    >
      <div className="qc-answer-image-heading">
        <span className="qc-type-icon">
          <Image size={22} aria-hidden="true" />
        </span>
        <div>
          <h4>صورة الإجابة</h4>
          <p>
            تظهر هذه الصورة عند كشف الإجابة فقط، وتبقى منفصلة عن صورة السؤال.
          </p>
        </div>
      </div>
      <div
        className="qc-media-tabs"
        role="group"
        aria-label="مصدر صورة الإجابة"
      >
        <button
          type="button"
          aria-pressed={mode === "upload"}
          className={mode === "upload" ? "selected" : ""}
          onClick={() => setMode("upload")}
        >
          <UploadCloud size={17} aria-hidden="true" /> رفع صورة الإجابة
        </button>
        <button
          type="button"
          aria-pressed={mode === "library"}
          className={mode === "library" ? "selected" : ""}
          onClick={() => setMode("library")}
        >
          <Library size={17} aria-hidden="true" /> صورة من المكتبة
        </button>
      </div>
      {mode === "upload" ? (
        <>
          <input
            ref={fileInput}
            id={`${id}-file`}
            className="qc-file-input"
            type="file"
            tabIndex={-1}
            aria-label="اختر صورة الإجابة"
            accept={imageTypes.join(",")}
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
              if (busy) return;
              if (event.dataTransfer.files.length > 1)
                onError("اختر صورة واحدة للإجابة.");
              else chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={32} strokeWidth={1.5} aria-hidden="true" />
            <strong>
              {file ? file.name : "اسحب صورة الإجابة هنا أو اخترها من جهازك"}
            </strong>
            <span>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} ميغابايت`
                : "PNG أو JPG أو WebP · حتى 10 ميغابايت"}
            </span>
            <button
              type="button"
              className="qc-button qc-secondary"
              onClick={() => fileInput.current?.click()}
            >
              {file ? "تغيير صورة الإجابة" : "اختيار صورة الإجابة"}
            </button>
          </div>
          {uploaded && (
            <p className="qc-upload-kept">
              <CheckCircle2 size={17} aria-hidden="true" /> صورة الإجابة محفوظة.
              إعادة الإرسال لن ترفعها مرة أخرى.
            </p>
          )}
        </>
      ) : (
        <div className="qc-library-picker">
          {loading ? (
            <p role="status">جارٍ تحميل الصور…</p>
          ) : loadError ? (
            <div>
              <p role="alert">{loadError}</p>
              <button
                type="button"
                className="qc-text-button"
                onClick={() => setReload((value) => value + 1)}
              >
                إعادة تحميل الصور
              </button>
            </div>
          ) : assets.length ? (
            <label htmlFor={`${id}-asset`}>
              صورة الإجابة المحفوظة
              <select
                id={`${id}-asset`}
                required
                value={selected?.id || ""}
                onChange={(event) =>
                  setSelected(
                    assets.find((asset) => asset.id === event.target.value) ||
                      null,
                  )
                }
              >
                <option value="">اختر صورة الإجابة</option>
                {assets.map((asset, index) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.credit} · {asset.mime.split("/")[1].toUpperCase()} ·
                    الصورة {index + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              لا توجد صور محفوظة بعد. اختر «رفع صورة الإجابة» لإضافة صورة جديدة.
            </p>
          )}
          {selected && (
            <p className="qc-asset-credit">
              {selected.credit} · {selected.license}
              {selected.source && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={selected.source}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    مصدر صورة الإجابة
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
      {imageUrl && (
        <figure className="qc-preview" data-testid="answer-image-preview">
          <img src={imageUrl} alt={alt.trim() || "معاينة صورة الإجابة"} />
          <figcaption>معاينة الإجابة التي ستظهر بعد الكشف</figcaption>
          <button
            type="button"
            className="qc-text-button qc-remove-image"
            onClick={removeImage}
          >
            <X size={17} aria-hidden="true" /> إزالة صورة الإجابة
          </button>
        </figure>
      )}
      <details className="qc-extras qc-accessibility">
        <summary>وصف صورة الإجابة لقارئ الشاشة (اختياري)</summary>
        <label htmlFor={`${id}-alt`}>
          وصف صورة الإجابة
          <input
            id={`${id}-alt`}
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
            minLength={5}
            maxLength={500}
            placeholder="صف الصورة لمن يستخدم قارئ الشاشة"
          />
        </label>
      </details>
      {mode === "upload" && (
        <div className="qc-rights">
          <h4>
            <ShieldCheck size={17} aria-hidden="true" /> حقوق استخدام صورة
            الإجابة
          </h4>
          <div className="qc-grid">
            <label htmlFor={`${id}-rights`}>
              مصدر حقوق صورة الإجابة
              <select
                id={`${id}-rights`}
                disabled={!!uploaded || busy}
                value={rights}
                onChange={(event) => {
                  setRights(event.target.value as "original" | "licensed");
                  setConfirmed(false);
                }}
              >
                <option value="original">صورة أصلية أملك حقوقها</option>
                <option value="licensed">
                  صورة لدي إذن أو ترخيص باستخدامها
                </option>
              </select>
            </label>
            <label htmlFor={`${id}-credit`}>
              صاحب صورة الإجابة أو الجهة المنتجة
              <input
                id={`${id}-credit`}
                value={credit}
                disabled={!!uploaded || busy}
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
                ترخيص صورة الإجابة أو وصف الإذن
                <input
                  id={`${id}-license`}
                  value={license}
                  disabled={!!uploaded || busy}
                  onChange={(event) => setLicense(event.target.value)}
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder="مثل CC BY 4.0، أو إذن كتابي من صاحب الحقوق"
                />
              </label>
              <label htmlFor={`${id}-source`}>
                رابط مصدر صورة الإجابة
                <input
                  id={`${id}-source`}
                  type="url"
                  dir="ltr"
                  value={source}
                  disabled={!!uploaded || busy}
                  onChange={(event) => setSource(event.target.value)}
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
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              required
            />{" "}
            أؤكد أن لدي حق نشر صورة الإجابة واستخدامها في اللعبة.
          </label>
        </div>
      )}
    </div>
  );
});

export default AnswerImagePicker;
