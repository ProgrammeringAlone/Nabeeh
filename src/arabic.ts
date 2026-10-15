/** Shared labels for values returned by the API. */
export const statusLabels: Readonly<Record<string, string>> = {
  pending: "بانتظار المراجعة",
  review: "بانتظار المراجعة",
  approved: "معتمد",
  duplicate: "مكرّر",
  rejected: "مرفوض",
  archived: "مؤرشف",
  retired: "موقوف نهائيًا",
  queued: "بانتظار التنفيذ",
  running: "قيد التنفيذ",
  finished: "مكتمل",
  failed: "فشل التنفيذ",
  active: "قيد اللعب",
  abandoned: "متوقّف",
  available: "متاح",
  open: "مفتوح",
  revealed: "الإجابة ظاهرة",
  completed: "مكتمل",
  resolved: "تمّت معالجته",
  correct: "إجابة صحيحة",
  incorrect: "إجابة خاطئة",
  skipped: "تمّ تجاوزه",
};

export const formatLabels: Readonly<Record<string, string>> = {
  text: "نص",
  choice: "اختيار من متعدد",
  ordering: "ترتيب",
  word: "حروف مبعثرة",
  image: "صورة",
  audio: "صوت",
  video: "فيديو",
};

export const difficultyLabels: Readonly<Record<string, string>> = {
  all: "كل المستويات",
  mixed: "مزيج المستويات",
  easy: "سهل",
  medium: "متوسط",
  hard: "صعب",
  expert: "خبير",
};

export const roleLabels: Readonly<Record<string, string>> = {
  player: "لاعب",
  editor: "محرّر",
  admin: "مدير",
};

export const modeLabels: Readonly<Record<string, string>> = {
  classic: "تحدّي الفريقين",
  rapid: "تحدّي سريع",
};

export const regionLabels: Readonly<Record<string, string>> = {
  all: "كل المناطق",
  sa: "السعودية",
  kw: "الكويت",
  ae: "الإمارات",
  bh: "البحرين",
  qa: "قطر",
  om: "عُمان",
};

export const lifelineLabels: Readonly<Record<string, string>> = {
  hint: "تلميح",
  double: "مضاعفة النقاط",
  "extra-time": "وقت إضافي",
};

/** Keep missing or future enum values from appearing as untranslated codes. */
export function labelFor(
  labels: Readonly<Record<string, string>>,
  value: unknown,
  fallback = "غير محدد",
): string {
  return typeof value === "string" ? labels[value] || fallback : fallback;
}
