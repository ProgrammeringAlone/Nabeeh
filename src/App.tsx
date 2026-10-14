import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Search,
  Heart,
  Check,
  Clock,
  Users,
  ChevronDown,
  Menu,
  X,
  Sparkles,
  Trophy,
  ShieldCheck,
  Play,
  RotateCcw,
  Lightbulb,
  Zap,
  Plus,
  BookOpen,
  Globe,
  FlaskConical,
  Landmark,
  Goal,
  Brain,
  Sun,
  Download,
  LogOut,
  Flag,
  Settings,
} from "lucide-react";
type Category = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  region: string;
  available: number;
  total: number;
  favorite: boolean;
  easy: number;
  medium: number;
  hard: number;
};
type Me = {
  profileId: string;
  userId: string | null;
  username: string | null;
  role: string;
  seen: number;
};
function categoryHasEnoughQuestions(c: Category, rounds = 1, difficulty = "mixed") {
  return c.available >= rounds * 3 &&
    (difficulty !== "mixed" || [c.easy, c.medium, c.hard].every(count => count >= rounds));
}
type Game = {
  id: string;
  status: string;
  mode: string;
  activeTeam: number;
  turnTeam: number;
  timer: number;
  stealing: boolean;
  lifelines: string[];
  teams: { name: string; score: number; team_index: number }[];
  categories: Category[];
  tiles: {
    id: string;
    category_id: string;
    value: number;
    status: string;
    outcome: string | null;
  }[];
  uses: { team_index: number; kind: string }[];
  current: null | {
    id: string;
    question_id: string;
    text: string;
    status: string;
    answer: string | null;
    accepted_answers: string[] | null;
    explanation: string | null;
    hint: string | null;
    hint_used: boolean;
    multiplier: number;
    value: number;
    deadline: string;
    format: string;
    options: string[] | null;
    response: { items?: string[]; choice?: string } | null;
    ordering_answer: string[] | null;
    media_id: string | null;
    media_alt: string | null;
    media_transcript: string | null;
    media_credit: string | null;
    media_license: string | null;
    media_source: string | null;
  };
  serverTime: number;
};
const icons: Record<string, typeof Brain> = {
  culture: Sparkles,
  gulf: Sun,
  geography: Globe,
  science: FlaskConical,
  sport: Goal,
  language: BookOpen,
  logic: Brain,
  history: Landmark,
};
const regions = [
  ["all", "كل المناطق"],
  ["sa", "السعودية"],
  ["kw", "الكويت"],
  ["ae", "الإمارات"],
  ["bh", "البحرين"],
  ["qa", "قطر"],
  ["om", "عُمان"],
];
const difficulties = [
  ["mixed", "متنوّع"],
  ["easy", "سهل"],
  ["medium", "متوسط"],
  ["hard", "صعب"],
  ["expert", "خبير"],
];
const lifelineNames: Record<string, string> = {
  hint: "خيط الحلّ",
  double: "ضاعفها",
  "extra-time": "وقت إضافي",
};
async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Nabeeh-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "تعذّر إكمال الطلب.");
  return data;
}
const navigate = (path: string) => {
  window.location.hash = path;
  window.scrollTo({ top: 0, behavior: "instant" });
};
function useRoute() {
  const [route, setRoute] = useState(window.location.hash.slice(1) || "/");
  useEffect(() => {
    const f = () => setRoute(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return route;
}
function Icon({ category, size = 30 }: { category: string; size?: number }) {
  const C = icons[category] || Sparkles;
  return <C size={size} strokeWidth={1.5} aria-hidden="true" />;
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <button
      className={"brand " + (small ? "small" : "")}
      onClick={() => navigate("/")}
      aria-label="نبيه، الصفحة الرئيسية"
    >
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      <span>
        نبيه<span className="brand-dot">.</span>
      </span>
    </button>
  );
}
function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`button ${secondary ? "secondary" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Sparkles size={32} />
      <p>{children}</p>
    </div>
  );
}
function Confirmation({
  message,
  resolve,
}: {
  message: string;
  resolve: (value: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        resolve(false);
      }}
      aria-labelledby="confirm-title"
    >
      <div className="dialog-icon">
        <ShieldCheck />
      </div>
      <h2 id="confirm-title">نتأكّد قبل ما نكمل</h2>
      <p>{message}</p>
      <div className="actions">
        <Button onClick={() => resolve(true)}>تأكيد</Button>
        <Button secondary onClick={() => resolve(false)}>
          رجوع
        </Button>
      </div>
    </dialog>
  );
}
export function App() {
  const route = useRoute(),
    [me, setMe] = useState<Me | null>(null),
    [offline, setOffline] = useState(!navigator.onLine),
    [menu, setMenu] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState<{
      message: string;
      resolve: (v: boolean) => void;
    } | null>(null);
  const refreshMe = () => api<Me>("/me").then(setMe);
  useEffect(() => {
    refreshMe().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setMenu(false);
    setError("");
  }, [route]);
  useEffect(() => {
    const on = () => setOffline(false),
      off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ.");
    } finally {
      setBusy(false);
    }
  };
  const confirm = (message: string) =>
    new Promise<boolean>((resolve) =>
      setConfirmation({
        message,
        resolve: (value) => {
          setConfirmation(null);
          resolve(value);
        },
      }),
    );
  const context = { me, refreshMe, run, busy, confirm };
  const inGame = route.startsWith("/game/");
  return (
    <>
      <a className="skip" href="#main">
        انتقل إلى المحتوى
      </a>
      <header className="header">
        <div className="container header-inner">
          <Brand />
          <nav
            className={menu ? "nav open" : "nav"}
            aria-label="التنقل الرئيسي"
          >
            <button
              className={route === "/" ? "active" : ""}
              onClick={() => navigate("/")}
            >
              الرئيسية
            </button>
            <button
              className={route === "/categories" ? "active" : ""}
              onClick={() => navigate("/categories")}
            >
              اكتشف الفئات
            </button>
            <button
              className={route === "/games" ? "active" : ""}
              onClick={() => navigate("/games")}
            >
              ألعابي
            </button>
            <button onClick={() => navigate("/account")}>
              {me?.username || "حسابي"}
            </button>
            {["editor", "admin"].includes(me?.role || "") && (
              <button onClick={() => navigate("/admin")}>التحرير</button>
            )}
          </nav>
          <div className="header-actions">
            <span className="tiny-tag">
              <span />
              جاهزين للّمة
            </span>
            <Button onClick={() => navigate("/setup")}>
              ابدأ التحدّي <ArrowLeft size={17} />
            </Button>
            <button
              className="icon-button menu-button"
              onClick={() => setMenu(!menu)}
              aria-label="القائمة"
              aria-expanded={menu}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} aria-busy={busy}>
        {offline && (
          <div role="status" className="error container">
            انقطع الاتصال. لعبتك محفوظة؛ أعد الاتصال لإكمالها.
          </div>
        )}
        {error && (
          <div role="alert" className="error container">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="إغلاق التنبيه"
              onClick={() => setError("")}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {!me ? (
          <div className="loading">نجهّز لك اللمّة…</div>
        ) : route === "/" ? (
          <Home {...context} />
        ) : route === "/categories" ? (
          <Library {...context} />
        ) : route === "/setup" ? (
          <Setup {...context} />
        ) : route === "/games" ? (
          <Saved {...context} />
        ) : inGame ? (
          <GameView id={route.split("/")[2]} {...context} />
        ) : route === "/account" ? (
          <Account {...context} />
        ) : route === "/admin" ? (
          <Admin {...context} />
        ) : route === "/privacy" ? (
          <Privacy />
        ) : (
          <Empty>
            الصفحة غير موجودة.{" "}
            <button onClick={() => navigate("/")}>ارجع للرئيسية</button>
          </Empty>
        )}
      </main>
      {!inGame && (
        <footer className="footer">
          <div className="container footer-inner">
            <div>
              <Brand small />
              <p>مو كل ذكي يفوز… لكن الفطين يعرف يلعبها صح.</p>
            </div>
            <div className="footer-links">
              <button onClick={() => navigate("/categories")}>الفئات</button>
              <button onClick={() => navigate("/games")}>ألعابي</button>
              <button onClick={() => navigate("/privacy")}>الخصوصية</button>
              <span>صُنع للّمة، بالعربي.</span>
            </div>
          </div>
        </footer>
      )}
      {confirmation && <Confirmation {...confirmation} />}
    </>
  );
}
type Context = {
  me: Me | null;
  refreshMe: () => Promise<void>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  confirm: (message: string) => Promise<boolean>;
};
function Home({ run, busy }: Context) {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    api<Category[]>("/categories")
      .then(setCategories)
      .catch(() => {});
  }, []);
  const demo = () =>
    run(async () => {
      const c = categories.find((c) => categoryHasEnoughQuestions(c));
      if (!c) throw new Error("لا توجد أسئلة جديدة كافية للتجربة.");
      const { id } = await api("/games", {
        categoryIds: [c.id],
        mode: "classic",
        teamNames: ["فريقك", "المنافسون"],
        timer: 90,
        questionsPerCategory: 3,
      });
      navigate("/game/" + id);
    });
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="mini-star">✦</span> لفريقك، لأهلك، ولكل لمّة حلوة
            </div>
            <h1>
              اللّمّة تحلى
              <br />
              بـ<span className="highlight">تحدّي.</span>
            </h1>
            <p className="hero-description">
              فريقان. أسئلة جديدة. وحماس ما يهدأ.
              <br />
              اجمع أحبابك، اختر فئاتك، وخلّ الفطين يفوز.
            </p>
            <div className="hero-buttons">
              <Button onClick={() => navigate("/setup")}>
                يلا نلعب <ArrowLeft size={20} />
              </Button>
              <button className="demo-button" onClick={demo} disabled={busy}>
                <span>
                  <Play size={15} fill="currentColor" />
                </span>
                جرّب جولة حقيقية
              </button>
            </div>
            <div className="hero-benefits">
              <span>
                <Check size={16} />
                بدون تسجيل
              </span>
              <span>
                <Check size={16} />
                أسئلة ما شفتها
              </span>
              <span>
                <Check size={16} />
                على أي شاشة
              </span>
            </div>
          </div>
          <div className="hero-art" aria-label="لوحة توضيحية لمنافسة فريقين">
            <span className="art-doodle doodle-one">✳</span>
            <span className="art-doodle doodle-two">✦</span>
            <div className="floating-note">
              <span className="note-icon">
                <Lightbulb size={21} />
              </span>
              <div>
                <strong>مو بس معلومات…</strong>
                <span>فطنة، سرعة، وروح فريق!</span>
              </div>
            </div>
            <div className="sample-board">
              <div className="sample-top">
                <Brand small />
                <span>
                  الجولة الأولى <span className="sample-dot" />
                </span>
              </div>
              <div className="sample-teams">
                <div>
                  <span className="team-dot coral" />
                  الصقور<strong>٨٠٠</strong>
                </div>
                <span>VS</span>
                <div>
                  <span className="team-dot purple" />
                  النمور<strong>٦٠٠</strong>
                </div>
              </div>
              <div className="sample-columns">
                {["gulf", "science", "logic"].map((id, i) => (
                  <div key={id}>
                    <div className="sample-category">
                      <Icon category={id} size={24} />
                      <span>
                        {["السعودية والخليج", "علوم وطبيعة", "ألغاز ومنطق"][i]}
                      </span>
                    </div>
                    {[200, 400, 600].map((n, j) => (
                      <div
                        key={n}
                        className={`sample-tile ${(i === 1 && j === 1) || (i === 0 && j === 0) ? "used" : ""}`}
                      >
                        {(i === 1 && j === 1) || (i === 0 && j === 0) ? (
                          <Check size={19} />
                        ) : (
                          n
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="sample-bottom">
                <span>
                  <span className="team-dot coral" /> الدور على الصقور
                </span>
                <span>
                  <Clock size={13} /> ٠١:٠٠
                </span>
              </div>
            </div>
            <div className="fresh-sticker">
              <ShieldCheck size={25} />
              <div>
                <strong>كل سؤال… فرصة جديدة</strong>
                <span>سجلّك يحفظ الأسئلة اللي شفتها</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="trust-strip">
        <div className="container">
          <span>
            <Users />
            فريقان، شاشة واحدة
          </span>
          <span>
            <ShieldCheck />
            أسئلتك محفوظة في سجلّك
          </span>
          <span>
            <Lightbulb />
            مساعدات تقلب الموازين
          </span>
          <span>
            <Trophy />
            اللمّة هي المكسب
          </span>
        </div>
      </section>
      <section className="section container" id="categories">
        <div className="section-heading">
          <div>
            <div className="eyebrow">كل لمّة ولها جوّها</div>
            <h2>وش مجالكم؟</h2>
            <p>اختاروا اللي تحبّونه… أو تحدّوا أنفسكم بشيء جديد.</p>
          </div>
          <button
            className="text-button"
            onClick={() => navigate("/categories")}
          >
            شوف كل الفئات <ArrowLeft size={18} />
          </button>
        </div>
        <div className="category-grid">
          {categories.slice(0, 8).map((c) => (
            <CategoryCard
              key={c.id}
              category={c}
              onChoose={() => {
                sessionStorage.setItem("nabeeh-category", c.id);
                navigate("/setup");
              }}
            />
          ))}
        </div>
        <div className="editorial-note">
          <ShieldCheck size={17} />
          المكتبة الحالية تجريبية ومحدودة. إذا انتهت الأسئلة الجديدة، نخبرك ولا
          نكرّرها.
        </div>
      </section>
      <section className="how-section">
        <div className="container">
          <div className="section-heading centered">
            <div className="eyebrow">أقل إعداد، أكثر حماس</div>
            <h2>من «مين يلعب؟» إلى أول تحدّي</h2>
          </div>
          <div className="steps">
            <div>
              <span className="step-number">١</span>
              <h3>قسّموا الفريقين</h3>
              <p>اختاروا أسماءكم وجهّزوا روح المنافسة.</p>
            </div>
            <div>
              <span className="step-number">٢</span>
              <h3>اختاروا فئاتكم</h3>
              <p>من الخليج للعلوم، ومن الكورة للألغاز.</p>
            </div>
            <div>
              <span className="step-number">٣</span>
              <h3>خلّوا الفطين يفوز</h3>
              <p>اختاروا قيمة السؤال، جاوبوا، واجمعوا النقاط.</p>
            </div>
          </div>
        </div>
      </section>
      <section className="section container">
        <div className="section-heading">
          <div>
            <div className="eyebrow">لكل لمّة إيقاع</div>
            <h2>اختاروا شكل التحدّي</h2>
          </div>
        </div>
        <div className="mode-grid">
          <button
            className="mode-card classic"
            onClick={() => {
              sessionStorage.setItem("nabeeh-mode", "classic");
              navigate("/setup");
            }}
          >
            <span className="pill">خيار اللمّة</span>
            <Trophy size={42} />
            <h3>تحدّي الفريقين</h3>
            <p>لوحة فئات، نقاط متدرّجة، ومساعدات في الوقت الصح.</p>
            <span>
              نلعبها <ArrowLeft size={18} />
            </span>
          </button>
          <button
            className="mode-card rapid"
            onClick={() => {
              sessionStorage.setItem("nabeeh-mode", "rapid");
              navigate("/setup");
            }}
          >
            <span className="pill">للي يحبّ السرعة</span>
            <Zap size={42} />
            <h3>تحدّي سريع</h3>
            <p>نفس روح المنافسة، لكن لكل سؤال ٣٠ ثانية أو أقل.</p>
            <span>
              جاهزين؟ <ArrowLeft size={18} />
            </span>
          </button>
        </div>
      </section>
      <section className="lifeline-section">
        <div className="container lifeline-grid">
          <div>
            <div className="eyebrow">الفطنة تعرف متى تستخدمها</div>
            <h2>
              مساعدة واحدة
              <br />
              تقلب النتيجة.
            </h2>
            <p>
              لكل فريق استخدام واحد من كل مساعدة.
              <br />
              التوقيت قراركم… والحماس علينا.
            </p>
          </div>
          <div className="lifeline-cards">
            <div>
              <Lightbulb />
              <h3>خيط الحلّ</h3>
              <p>تلميح يفتح لك زاوية جديدة.</p>
            </div>
            <div>
              <Zap />
              <h3>ضاعفها</h3>
              <p>ضاعف نقاط السؤال قبل كشف الإجابة.</p>
            </div>
            <div>
              <Clock />
              <h3>وقت إضافي</h3>
              <p>٣٠ ثانية زيادة لترتيب الأفكار.</p>
            </div>
          </div>
        </div>
      </section>
      <section className="section container faq-section">
        <div>
          <div className="eyebrow">قبل ما تبدأ اللمّة</div>
          <h2>في بالكم سؤال؟</h2>
          <p>هنا بعض الإجابات.</p>
        </div>
        <div className="faq-list">
          {[
            [
              "هل نحتاج نسجّل حساب؟",
              "لا. تقدرون تبدأون كضيوف. سجلّ الأسئلة محفوظ على الخادم ويرتبط بملف تعريف آمن في هذا المتصفح.",
            ],
            [
              "هل تتكرّر الأسئلة؟",
              "السؤال الذي يُفتح يُسجّل كمشاهد، ولا يعود في اللعب العادي حتى لو غيّرنا صياغته أو فئته. إذا نفد المخزون نخبرك بوضوح. ضمان إعادة الصياغة يعتمد على جودة المراجعة التحريرية.",
            ],
            [
              "نقدر نكمل لعبة بعدين؟",
              "نعم. افتح «ألعابي» من نفس المتصفح، أو من أي جهاز بعد تسجيل الدخول لحسابك. المؤقّت يستمر أثناء غيابك.",
            ],
            [
              "هل نقدر نلعب على التلفزيون؟",
              "نعم، افتح الموقع على شاشة كبيرة أو شارك شاشة جهازك. يتحكّم المضيف بالأسئلة وتسجيل النتائج.",
            ],
            [
              "هل أسماء اللاعبين تحفظ سجلّهم؟",
              "الأسماء وحدها لا تربط الحسابات. يشارك اللاعب المسجّل رمزًا مؤقتًا مع المضيف ليشمل سجلّه استبعاد الأسئلة وتسجيل المشاهدة.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <Plus size={18} />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="final-cta container">
        <span className="cta-star">✦</span>
        <h2>اجمعهم. تحدّاهم. خلّها ليلة نبيه.</h2>
        <p>الأسئلة علينا… والضحك عليكم.</p>
        <Button onClick={() => navigate("/setup")}>
          ابدأ اللمّة <ArrowLeft size={20} />
        </Button>
      </section>
    </>
  );
}
function CategoryCard({
  category: c,
  onChoose,
  onFavorite,
  selected = false,
  level = 3,
}: {
  category: Category;
  onChoose: () => void;
  onFavorite?: () => void;
  selected?: boolean;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <article className={`category-card ${selected ? "selected" : ""}`}>
      <div className="category-art" style={{ background: c.color }}>
        <span className="art-orbit" />
        <span className="art-orbit second" />
        <Icon category={c.id} size={52} />
        {onFavorite && (
          <button
            aria-label={
              c.favorite
                ? "إزالة " + c.name + " من المفضلة"
                : "إضافة " + c.name + " للمفضلة"
            }
            aria-pressed={c.favorite}
            className="favorite-button"
            onClick={onFavorite}
          >
            <Heart size={18} fill={c.favorite ? "currentColor" : "none"} />
          </button>
        )}
        <span className="category-count">{c.available} سؤال جديد</span>
      </div>
      <button className="category-body" onClick={onChoose}>
        <div>
          <Heading>{c.name}</Heading>
          {selected ? <Check size={18} /> : <ArrowLeft size={18} />}
        </div>
        <p>{c.description}</p>
      </button>
    </article>
  );
}
function Library({ run }: Context) {
  const [categories, setCategories] = useState<Category[]>([]),
    [q, setQ] = useState(""),
    [region, setRegion] = useState("all"),
    [difficulty, setDifficulty] = useState("all"),
    [favorite, setFavorite] = useState(false),
    [loading, setLoading] = useState(true);
  const load = () =>
    api<Category[]>(
      "/categories?" + new URLSearchParams({ q, region, difficulty }),
    ).then(setCategories);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        api<Category[]>(
          "/categories?" + new URLSearchParams({ q, region, difficulty }),
        )
          .then((c) => {
            if (active) setCategories(c);
          })
          .finally(() => active && setLoading(false)),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, region, difficulty]);
  return (
    <section className="section container">
      <div className="page-heading">
        <div className="eyebrow">فضولك يختار</div>
        <h1>اكتشف الفئات</h1>
        <p>أسئلة جديدة من مجالات تحبّها، ومجالات تستحق تجربتها.</p>
      </div>
      <div className="filters">
        <label className="search-box">
          <Search size={19} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن فئة…"
            aria-label="ابحث عن فئة"
          />
        </label>
        <label className="select-label">
          المنطقة
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            {regions.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="select-label">
          المستوى
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <option value="all">كل المستويات</option>
            {difficulties.slice(1).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`filter-chip ${favorite ? "chosen" : ""}`}
          aria-pressed={favorite}
          onClick={() => setFavorite(!favorite)}
        >
          <Heart size={16} />
          المفضّلة
        </button>
      </div>
      <div className="result-count" role="status">
        {loading
          ? "نبحث…"
          : `${categories.filter((c) => !favorite || c.favorite).length} فئات متاحة`}
      </div>
      <div className="category-grid">
        {categories
          .filter((c) => !favorite || c.favorite)
          .map((c) => (
            <CategoryCard
              key={c.id}
              category={c}
              level={2}
              onChoose={() => {
                sessionStorage.setItem("nabeeh-category", c.id);
                navigate("/setup");
              }}
              onFavorite={() =>
                run(async () => {
                  await api("/favorites", {
                    categoryId: c.id,
                    favorite: !c.favorite,
                  });
                  await load();
                })
              }
            />
          ))}
      </div>
      {!loading &&
        !categories.filter((c) => !favorite || c.favorite).length && (
          <Empty>ما لقينا فئات بهذه الخيارات. جرّب تغيير البحث.</Empty>
        )}
      <p className="muted">
        المتاح يُحسب لملفك الحالي. اختيار فئة متعددة اللاعبين يخضع أيضًا لسجلّ
        المشاركين.
      </p>
    </section>
  );
}
function Setup({ run, busy }: Context) {
  const [categories, setCategories] = useState<Category[]>([]),
    [selected, setSelected] = useState<string[]>(() => {
      const c = sessionStorage.getItem("nabeeh-category");
      sessionStorage.removeItem("nabeeh-category");
      return c ? [c] : ["gulf", "science", "logic"];
    }),
    [mode, setMode] = useState(
      sessionStorage.getItem("nabeeh-mode") || "classic",
    ),
    [names, setNames] = useState(["الصقور", "النمور"]),
    [timer, setTimer] = useState(60),
    [rounds, setRounds] = useState(1),
    [difficulty, setDifficulty] = useState("mixed"),
    [region, setRegion] = useState("all"),
    [stealing, setStealing] = useState(true),
    [negative, setNegative] = useState(false),
    [lifelines, setLifelines] = useState(["hint", "double"]),
    [players, setPlayers] = useState(["", ""]),
    [tokens, setTokens] = useState("");
  useEffect(() => {
    sessionStorage.removeItem("nabeeh-mode");
  }, []);
  useEffect(() => {
    let active=true;
    api<Category[]>(
      "/categories?" +
        new URLSearchParams({
          region,
          difficulty: difficulty === "mixed" ? "all" : difficulty,
        }),
    )
      .then(rows=>{
        if(!active)return;setCategories(rows);
        setSelected(previous=>{
          const valid=previous.filter(id=>rows.some(c=>c.id===id && categoryHasEnoughQuestions(c,rounds,difficulty)));
          return valid.length?valid:rows.filter(c=>categoryHasEnoughQuestions(c,rounds,difficulty)).slice(0,3).map(c=>c.id);
        });
      })
      .catch(() => {});
    return()=>{active=false;};
  }, [region, difficulty,rounds]);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id)
        ? s.filter((x) => x !== id)
        : s.length < 6
          ? [...s, id]
          : s,
    );
  const start = () =>
    run(async () => {
      if (!selected.length) throw new Error("اختر فئة واحدة على الأقل.");
      if (selected.some(id=>!categories.some(c=>c.id===id && categoryHasEnoughQuestions(c,rounds,difficulty))))
        throw new Error("اختر فئة تتوفر فيها أسئلة كافية للمستوى المحدد.");
      const { id } = await api("/games", {
        categoryIds: selected,
        mode,
        teamNames: names,
        timer: mode === "rapid" ? Math.min(30, timer) : timer,
        questionsPerCategory: rounds * 3,
        difficulty,
        region,
        stealing,
        negativeScores: negative,
        lifelines,
        players: players.flatMap((list, team) =>
          list
            .split("،")
            .map((name) => ({ name: name.trim(), team }))
            .filter((x) => x.name),
        ),
        participantTokens: tokens.split(/[\s,،]+/).filter(Boolean),
      });
      navigate("/game/" + id);
    });
  return (
    <section className="section container setup-page">
      <div className="page-heading">
        <div className="eyebrow">جهّزوا روح المنافسة</div>
        <h1>نرتّب اللمّة؟</h1>
        <p>اختيارات بسيطة، وليلة مليانة تحدّي.</p>
      </div>
      <div className="setup-layout">
        <div>
          <section className="setup-panel">
            <h2>
              <span className="number-badge">١</span>كيف تحبّون تلعبون؟
            </h2>
            <div className="mode-options">
              {[
                ["classic", "تحدّي الفريقين", "وقت أوسع وقرارات استراتيجية"],
                ["rapid", "تحدّي سريع", "٣٠ ثانية أو أقل لكل سؤال"],
              ].map(([v, l, d]) => (
                <button
                  key={v}
                  className={mode === v ? "option chosen" : "option"}
                  aria-pressed={mode === v}
                  onClick={() => setMode(v)}
                >
                  {v === "classic" ? <Trophy /> : <Zap />}
                  <strong>{l}</strong>
                  <span>{d}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="setup-panel">
            <h2>
              <span className="number-badge">٢</span>من يتحدّى من؟
            </h2>
            <div className="team-inputs">
              {names.map((name, i) => (
                <div key={i} className={`team-input team-${i}`}>
                  <label>
                    اسم الفريق {i === 0 ? "الأول" : "الثاني"}
                    <input
                      maxLength={40}
                      value={name}
                      onChange={(e) =>
                        setNames((n) =>
                          n.map((v, j) => (j === i ? e.target.value : v)),
                        )
                      }
                    />
                  </label>
                  <label>
                    اللاعبون <span className="muted">(اختياري، افصل بـ ،)</span>
                    <input
                      value={players[i]}
                      onChange={(e) =>
                        setPlayers((p) =>
                          p.map((v, j) => (j === i ? e.target.value : v)),
                        )
                      }
                      placeholder="مثال: نورة، خالد"
                      maxLength={400}
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>
          <section className="setup-panel">
            <div className="panel-title">
              <h2>
                <span className="number-badge">٣</span>اختاروا فئاتكم
              </h2>
              <button
                className="text-button"
                onClick={() => {
                  const ids = categories
                    .filter((c) => categoryHasEnoughQuestions(c,rounds,difficulty))
                    .map((c) => c.id);
                  for (let i = ids.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [ids[i], ids[j]] = [ids[j], ids[i]];
                  }
                  setSelected(ids.slice(0, 3));
                }}
              >
                <RotateCcw size={16} />
                اختيار عشوائي
              </button>
            </div>
            <div className="setup-filters">
              <label>
                المنطقة
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  {regions.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                المستوى
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  {difficulties.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="category-select-grid">
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`category-option ${selected.includes(c.id) ? "chosen" : ""}`}
                  aria-pressed={selected.includes(c.id)}
                  onClick={() => toggle(c.id)}
                  disabled={
                    !categoryHasEnoughQuestions(c,rounds,difficulty) && !selected.includes(c.id)
                  }
                >
                  <span style={{ background: c.color }}>
                    <Icon category={c.id} size={24} />
                  </span>
                  <strong>{c.name}</strong>
                  <small>{c.available} سؤال جديد</small>
                  {c.available > 0 && !categoryHasEnoughQuestions(c,rounds,difficulty) && <small>بانتظار أسئلة بالمستويات المطلوبة</small>}
                  {selected.includes(c.id) && (
                    <Check className="selection-check" size={17} />
                  )}
                </button>
              ))}
            </div>
            <p className="muted">
              من فئة إلى ٦ فئات. كل جولة تضيف سؤالًا بقيمة ٢٠٠ و٤٠٠ و٦٠٠ في
              المستوى المتنوّع.
            </p>
          </section>
          <section className="setup-panel">
            <h2>
              <span className="number-badge">٤</span>قواعد اللمّة
            </h2>
            <div className="setup-filters">
              <label>
                الجولات
                <select
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                >
                  <option value={1}>جولة واحدة — ٣ أسئلة لكل فئة</option>
                  <option value={2}>جولتان — ٦ أسئلة لكل فئة</option>
                </select>
              </label>
              <label>
                وقت السؤال
                <select
                  value={timer}
                  onChange={(e) => setTimer(Number(e.target.value))}
                >
                  {[15, 30, 60, 90, 120, 180].map((n) => (
                    <option
                      key={n}
                      value={n}
                      disabled={mode === "rapid" && n > 30}
                    >
                      {n} ثانية
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={stealing}
                onChange={(e) => setStealing(e.target.checked)}
              />
              السماح للفريق الآخر بخطف السؤال بعد كشف الإجابة
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={negative}
                onChange={(e) => setNegative(e.target.checked)}
              />
              خصم قيمة السؤال عند الإجابة الخاطئة
            </label>
            <h3>المساعدات</h3>
            <div className="lifeline-options">
              {Object.entries(lifelineNames).map(([v, l]) => (
                <label key={v} className="check-row">
                  <input
                    type="checkbox"
                    checked={lifelines.includes(v)}
                    onChange={() =>
                      setLifelines((s) =>
                        s.includes(v) ? s.filter((x) => x !== v) : [...s, v],
                      )
                    }
                  />
                  {l}
                </label>
              ))}
            </div>
            <details className="participant-details">
              <summary>
                ربط سجلّ المشاركين المسجّلين <ChevronDown size={16} />
              </summary>
              <p>
                كل مشارك ينشئ رمزًا من «حسابي» ويشاركه مع المضيف. الأسئلة
                تُستبعد إذا شاهدها أي مشارك، وتُسجّل للجميع عند عرضها. أسماء
                اللاعبين وحدها لا تحفظ تاريخهم.
              </p>
              <label>
                رموز المشاركة
                <textarea
                  value={tokens}
                  onChange={(e) => setTokens(e.target.value)}
                  placeholder="رمز لكل سطر"
                  maxLength={1400}
                />
              </label>
            </details>
          </section>
        </div>
        <aside className="setup-summary">
          <span className="eyebrow">اللمّة جاهزة</span>
          <h2>
            {names[0] || "الفريق الأول"}
            <span>ضد</span>
            {names[1] || "الفريق الثاني"}
          </h2>
          <div className="summary-row">
            <span>الفئات</span>
            <strong>{selected.length}</strong>
          </div>
          <div className="summary-row">
            <span>الأسئلة</span>
            <strong>{selected.length * rounds * 3}</strong>
          </div>
          <div className="summary-row">
            <span>وقت السؤال</span>
            <strong>
              {mode === "rapid" ? Math.min(30, timer) : timer} ثانية
            </strong>
          </div>
          <div className="summary-row">
            <span>المساعدات لكل فريق</span>
            <strong>{lifelines.length}</strong>
          </div>
          <Button
            onClick={start}
            disabled={busy || !selected.length || names.some((n) => !n.trim()) || selected.some(id=>!categories.some(c=>c.id===id && categoryHasEnoughQuestions(c,rounds,difficulty)))}
          >
            ابدأ اللعبة <ArrowLeft size={18} />
          </Button>
          <p>
            <ShieldCheck size={16} />
            نحجز أسئلة جديدة فقط. إذا كان المخزون غير كافٍ، لن نملأ اللوحة
            بأسئلة سابقة.
          </p>
        </aside>
      </div>
    </section>
  );
}
function Saved({ run }: Context) {
  const [games, setGames] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    run(async () => {
      setGames(await api("/games"));
      setLoading(false);
    });
  }, []);
  return (
    <section className="section container">
      <div className="page-heading">
        <div className="eyebrow">كل لمّة لها حكاية</div>
        <h1>ألعابي</h1>
        <p>كمّل من آخر سؤال، أو تذكّر نتيجة ليلة حلوة.</p>
      </div>
      {!loading && !games.length ? (
        <Empty>
          ما بدأت لعبة بعد.{" "}
          <button className="text-button" onClick={() => navigate("/setup")}>
            يلا نلعب <ArrowLeft size={16} />
          </button>
        </Empty>
      ) : (
        <div className="saved-grid">
          {games.map((g) => (
            <article key={g.id} className="saved-card">
              <span className={`status-badge ${g.status}`}>
                {g.status === "active"
                  ? "قيد اللعب"
                  : g.status === "finished"
                    ? "مكتملة"
                    : "متوقّفة"}
              </span>
              <h2>{g.mode === "classic" ? "تحدّي الفريقين" : "تحدّي سريع"}</h2>
              <p>
                {new Date(g.created_at).toLocaleDateString("ar-SA")} ·{" "}
                {g.completed} / {g.total} أسئلة
              </p>
              <Button secondary onClick={() => navigate("/game/" + g.id)}>
                {g.status === "active" ? "كمّل اللعبة" : "شوف النتيجة"}{" "}
                <ArrowLeft size={16} />
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function GameView({
  id,
  me,
  run,
  busy,
  confirm,
  refreshMe,
}: Context & { id: string }) {
  const [game, setGame] = useState<Game | null>(null),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0);
  const update = (g: Game) => {
    setGame(g);
    const receivedAt = Date.now();
    setNow(receivedAt);
    setOffset(g.serverTime - receivedAt);
    try {
      localStorage.setItem("nabeeh-last-game", g.id);
      if (g.current) {
        const key = "nabeeh-seen-" + (me?.profileId || "guest");
        const prior = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(
          key,
          JSON.stringify([...new Set([...prior, g.current.question_id])]),
        );
      }
    } catch {
      /* Browser storage is supplemental; server ledger is authoritative. */
    }
  };
  useEffect(() => {
    run(async () => update(await api("/games/" + id)));
  }, [id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const mutate = (action: string, body: unknown = {}) =>
    run(async () => {
      update(await api("/games/" + id + "/" + action, body));
      await refreshMe();
    });
  if (!game) return <div className="loading">نسترجع لوحتك…</div>;
  const finished = game.status !== "active",
    completed = game.tiles.filter((t) => t.status === "completed").length;
  const q = game.current,
    remaining = q
      ? Math.max(
          0,
          Math.ceil((new Date(q.deadline).getTime() - now - offset) / 1000),
        )
      : 0;
  const award = async (outcome: string, team?: number) => {
    if (!q) return;
    if (
      await confirm(
        outcome === "correct"
          ? `تسجيل إجابة صحيحة لفريق ${game.teams[team ?? game.turnTeam].name} بقيمة ${q.value * ((team ?? game.turnTeam) === game.turnTeam ? q.multiplier : 1)} نقطة؟`
          : "تسجيل السؤال " +
              (outcome === "skipped" ? "كمتجاوز" : "كإجابة خاطئة") +
              "؟ لا يمكن تعديل النتيجة بعد التأكيد.",
      )
    )
      mutate("score", { instanceId: q.id, outcome, team });
  };
  const winner =
    game.teams[0].score === game.teams[1].score
      ? null
      : game.teams[0].score > game.teams[1].score
        ? game.teams[0]
        : game.teams[1];
  return (
    <section className="game-page container">
      <div className="game-toolbar">
        <button className="text-button" onClick={() => navigate("/games")}>
          <ArrowRight size={17} />
          ألعابي
        </button>
        <span>{game.mode === "classic" ? "تحدّي الفريقين" : "تحدّي سريع"}</span>
        <span>
          {completed} / {game.tiles.length} أسئلة
        </span>
      </div>
      <div className="scoreboard">
        {game.teams.map((t, i) => (
          <div
            key={i}
            className={`score-team team-${i} ${!finished && game.activeTeam === i ? "active-team" : ""}`}
          >
            <div>
              <span className="team-dot" />
              <h2>{t.name}</h2>
              {!finished && game.activeTeam === i && (
                <span className="turn-pill">عليكم الدور</span>
              )}
            </div>
            <strong aria-label={`نقاط ${t.name}: ${t.score}`}>
              {t.score.toLocaleString("ar-SA-u-nu-latn")}
            </strong>
            <div className="team-lifelines">
              {game.lifelines.map((k) => (
                <span
                  key={k}
                  className={
                    game.uses.some((u) => u.team_index === i && u.kind === k)
                      ? "spent"
                      : ""
                  }
                >
                  {lifelineNames[k]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {finished ? (
        <div className="results">
          <Trophy size={56} />
          <div className="eyebrow">
            {game.status === "finished"
              ? "يا سلام على هاللمّة"
              : "اللعبة متوقّفة"}
          </div>
          <h1>
            {game.status === "abandoned"
              ? "نلقاكم في تحدّي جديد"
              : winner
                ? `مبروك يا ${winner.name}!`
                : "تعادل يليق بالمنافسين!"}
          </h1>
          <p>
            {completed} سؤالًا اكتمل. الأسئلة التي شاهدتموها محفوظة في السجلّ.
          </p>
          <div className="actions">
            <Button onClick={() => navigate("/setup")}>
              تحدّي جديد <ArrowLeft size={18} />
            </Button>
            <Button secondary onClick={() => navigate("/games")}>
              ألعابي
            </Button>
          </div>
        </div>
      ) : q ? (
        <div className="question-panel">
          <div className="question-meta">
            <span>
              {
                game.categories.find(
                  (c) =>
                    c.id === game.tiles.find((t) => t.id === q.id)?.category_id,
                )?.name
              }
            </span>
            <span>{q.value * q.multiplier} نقطة</span>
            <span
              className={`timer ${remaining <= 10 ? "urgent" : ""}`}
              role="timer"
              aria-label={`${remaining} ثانية متبقية`}
            >
              <Clock size={19} />
              {String(Math.floor(remaining / 60)).padStart(2, "0")}:
              {String(remaining % 60).padStart(2, "0")}
            </span>
          </div>
          <p className="question-instruction">
            {q.status === "revealed"
              ? "الإجابة مكشوفة — المضيف يسجّل النتيجة"
              : "تشاوروا… الوقت بدأ"}
          </p>
          <h1 data-testid="question-text">{q.text}</h1>
          {q.media_id && <figure className="question-media">
            {q.format === "image" ? <img src={`/api/games/${game.id}/media/${q.id}`} alt={q.media_alt || "تحدّي بصري"} />
              : q.format === "audio" ? <audio controls preload="metadata" aria-label={q.media_alt || "تحدّي صوتي"} src={`/api/games/${game.id}/media/${q.id}`} />
              : <video controls playsInline preload="metadata" aria-label={q.media_alt || "تحدّي مرئي"} src={`/api/games/${game.id}/media/${q.id}`} />}
            {q.media_transcript && <details><summary>بديل نصّي للوسائط</summary><p>{q.media_transcript}</p></details>}
            <figcaption><small>{q.media_credit} · {q.media_license}</small></figcaption>
          </figure>}
          {q.format === "ordering" && q.options ? <div className="ordering-challenge">
            <p>رتّب البطاقات باستخدام أزرار التقديم والتأخير. قرار النتيجة للمضيف.</p>
            <ol>
              {(q.response?.items || q.options).map((item,i,items) => <li key={item}>
                <span>{item}</span>
                <div>
                  <button aria-label={`قدّم ${item}`} disabled={busy || q.status !== "open" || remaining === 0 || i === 0} onClick={() => {
                    const next = [...items]; [next[i-1],next[i]]=[next[i],next[i-1]]; mutate("response",{items:next});
                  }}>↑</button>
                  <button aria-label={`أخّر ${item}`} disabled={busy || q.status !== "open" || remaining === 0 || i === items.length-1} onClick={() => {
                    const next = [...items]; [next[i+1],next[i]]=[next[i],next[i+1]]; mutate("response",{items:next});
                  }}>↓</button>
                </div>
              </li>)}
            </ol>
          </div> : q.format === "choice" && q.options ? <div className="choice-challenge" aria-label="خيارات الإجابة">
            {q.options.map(option => <button key={option} aria-pressed={q.response?.choice === option} disabled={busy || q.status !== "open" || remaining === 0} onClick={() => mutate("response",{choice:option})}>{option}</button>)}
          </div> : q.options && (
            <ol className="question-options">
              {q.options.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ol>
          )}
          {q.hint && (
            <div className="hint">
              <Lightbulb size={20} />
              {q.hint}
            </div>
          )}
          {q.status === "open" ? (
            <>
              <div className="question-lifelines">
                {game.lifelines.map((k) => (
                  <Button
                    key={k}
                    secondary
                    disabled={
                      busy ||
                      remaining === 0 ||
                      game.uses.some(
                        (u) => u.team_index === game.turnTeam && u.kind === k,
                      )
                    }
                    onClick={() => mutate("lifeline", { kind: k })}
                  >
                    {k === "hint" ? (
                      <Lightbulb size={17} />
                    ) : k === "double" ? (
                      <Zap size={17} />
                    ) : (
                      <Clock size={17} />
                    )}{" "}
                    {lifelineNames[k]}
                  </Button>
                ))}
              </div>
              {remaining === 0 && (
                <p role="status" className="timer-notice">
                  انتهى الوقت. اكشف الإجابة ثم سجّل الخطف أو التجاوز.
                </p>
              )}
              <Button onClick={() => mutate("reveal")} disabled={busy}>
                اكشف الإجابة <ChevronDown size={18} />
              </Button>
            </>
          ) : (
            <>
              <div className="answer">
                <span>الإجابة الصحيحة</span>
                <h2 data-testid="answer-text">{q.answer}</h2>
                {q.accepted_answers?.some(a=>a!==q.answer) && <p>تُقبل أيضًا: {q.accepted_answers.filter(a=>a!==q.answer).join("، ")}</p>}
                <p>{q.explanation}</p>
              </div>
              <div className="score-actions">
                <Button
                  disabled={busy || remaining === 0}
                  onClick={() => award("correct", game.turnTeam)}
                >
                  <Check size={18} />
                  صحيح — {game.teams[game.turnTeam].name}
                </Button>
                {game.stealing && (
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => award("correct", 1 - game.turnTeam)}
                  >
                    خطف — {game.teams[1 - game.turnTeam].name}
                  </Button>
                )}
                <Button
                  secondary
                  disabled={busy}
                  onClick={() => award("incorrect")}
                >
                  إجابة خاطئة
                </Button>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() => award("skipped")}
                >
                  تجاوز السؤال
                </Button>
              </div>
              <button
                className="text-button report-button"
                onClick={() =>
                  run(async () => {
                    const reason = window.prompt("ما المشكلة في السؤال؟");
                    if (reason)
                      await api("/reports", {
                        questionId: q.question_id,
                        reason,
                      });
                  })
                }
              >
                <Flag size={14} />
                بلّغ عن خطأ
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="board-intro">
            <h1>يا {game.teams[game.activeTeam].name}، اختاروا تحدّيكم.</h1>
            <p>كل ما زادت النقاط، زاد التحدّي.</p>
          </div>
          <div className="board-scroll">
            <div
              className="game-board"
              style={{
                gridTemplateColumns: `repeat(${game.categories.length}, minmax(145px, 1fr))`,
              }}
            >
              {game.categories.map((c) => (
                <div className="board-column" key={c.id}>
                  <div
                    className="board-category"
                    style={{ background: c.color }}
                  >
                    <Icon category={c.id} size={32} />
                    <h2>{c.name}</h2>
                  </div>
                  {game.tiles
                    .filter((t) => t.category_id === c.id)
                    .map((t) => (
                      <button
                        key={t.id}
                        className={`board-tile ${t.status === "completed" ? "used" : ""}`}
                        disabled={busy || t.status !== "available"}
                        aria-label={
                          c.name +
                          " " +
                          t.value +
                          " نقطة" +
                          (t.status === "completed" ? "، مستخدم" : "")
                        }
                        onClick={() => mutate("open", { instanceId: t.id })}
                      >
                        {t.status === "completed" ? (
                          <>
                            <Check size={20} />
                            <span>{t.value}</span>
                          </>
                        ) : (
                          <>
                            {t.value}
                            <small>نقطة</small>
                          </>
                        )}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {!finished && (
        <div className="game-bottom">
          <span>
            <ShieldCheck size={16} />
            اللعبة محفوظة تلقائيًا
          </span>
          <button
            className="text-button"
            onClick={async () => {
              if (
                await confirm(
                  "إنهاء اللعبة الآن؟ تبقى الأسئلة المعروضة في سجلّ المشاهدة، وتتحرّر الأسئلة التي لم تُفتح.",
                )
              )
                mutate("abandon");
            }}
          >
            إنهاء اللعبة
          </button>
        </div>
      )}
    </section>
  );
}
function Account({ me, run, busy, confirm, refreshMe }: Context) {
  const [register, setRegister] = useState(true),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [token, setToken] = useState(""),
    [recover, setRecover] = useState(false),
    [recoveryInput, setRecoveryInput] = useState(""),
    [recoveryKey, setRecoveryKey] = useState("");
  if (!me) return null;
  return (
    <section className="section container account-page">
      <div className="page-heading">
        <div className="eyebrow">سجلّك، معك</div>
        <h1>{me.username ? "أهلًا، " + me.username : "خلّ كل سؤال جديد"}</h1>
        <p>شاهدت {me.seen} سؤالًا. لا نعيدها في اللعب العادي.</p>
      </div>
      {!me.userId ? (
        <div className="account-grid">
          <form
            className="setup-panel"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await api("/auth/" + (recover ? "recover" : register ? "register" : "login"), {
                  username,
                  password,
                  ...(recover ? {recoveryKey:recoveryInput} : {}),
                });
                if (result.recoveryKey) setRecoveryKey(result.recoveryKey);
                if (recover) { setRecover(false); setRegister(false); setRecoveryInput(""); }
                setPassword("");
                await refreshMe();
              });
            }}
          >
            <div className="tabs">
              <button
                type="button"
                className={register ? "chosen" : ""}
                onClick={() => {setRegister(true);setRecover(false);}}
              >
                إنشاء حساب
              </button>
              <button
                type="button"
                className={!register ? "chosen" : ""}
                onClick={() => {setRegister(false);setRecover(false);}}
              >
                تسجيل الدخول
              </button>
            </div>
            <h2>{recover ? "استعد حسابك" : register ? "أسئلتك تتبعك على كل جهاز" : "ارجع لسجلّك"}</h2>
            {recover && <label>مفتاح الاستعادة<input dir="ltr" required value={recoveryInput} onChange={e=>setRecoveryInput(e.target.value)} autoComplete="off" /><small>المفتاح الذي حفظته عند إنشاء الحساب. صالح لسنة واحدة وللاستخدام مرة واحدة.</small></label>}
            <label>
              اسم المستخدم
              <input
                required
                autoComplete="username"
                dir="ltr"
                minLength={3}
                maxLength={30}
                pattern="[a-z0-9_]+"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
              />
              <small>٣–٣٠ حرفًا إنجليزيًا صغيرًا، رقمًا أو _</small>
            </label>
            <label>
              كلمة المرور
              <input
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete={register || recover ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <small>١٠ أحرف على الأقل</small>
            </label>
            <Button type="submit" disabled={busy}>
              {recover ? "غيّر كلمة المرور" : register ? "أنشئ حسابي" : "دخول"} <ArrowLeft size={18} />
            </Button>
            {!register && !recover && <button type="button" className="text-button" onClick={()=>setRecover(true)}>نسيت كلمة المرور؟</button>}
          </form>
          <div className="account-explanation">
            <ShieldCheck size={38} />
            <h2>
              الأسئلة التي شفتها
              <br />
              تظلّ محفوظة.
            </h2>
            <p>
              إنشاء حساب يربط سجلّ الضيف الحالي بحسابك. تسجيل الدخول يجمع سجلّ
              الضيف والحساب دون فقدان أي سؤال سابق. الألعاب النشطة للضيف تتوقّف
              عند الدمج حتى لا تتكرّر أسئلة محجوزة.
            </p>
            <p>
              كضيف، سجلّك مرتبط بهذا المتصفح. لا ينتقل إلى جهاز آخر، وقد تفقد
              الوصول إليه عند حذف بيانات المتصفح.
            </p>
          </div>
        </div>
      ) : (
        <div className="setup-panel">
          <h2>مشاركة سجلّك في لعبة جماعية</h2>
          <p>
            أنشئ رمزًا صالحًا لعشر دقائق وأعطه للمضيف. سيُستبعد أي سؤال شاهدته،
            وسيُسجّل لك كل سؤال يُعرض في تلك اللعبة. لا تشارك الرمز خارج
            مجموعتك.
          </p>
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              run(async () =>
                setToken((await api("/participants/token", {})).token),
              )
            }
          >
            أنشئ رمز مشاركة <Users size={17} />
          </Button>
          {token && (
            <output className="token" dir="ltr">
              {token}
            </output>
          )}
          <hr />
          <h2>مفتاح استعادة الحساب</h2>
          <p>احفظ المفتاح في مكان آمن خارج المتصفح. يتيح تغيير كلمة المرور مع بقاء ألعابك وسجلّ أسئلتك. إنشاء مفتاح جديد يلغي القديم.</p>
          <label>كلمة المرور لتجديد المفتاح<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} /></label>
          <Button secondary disabled={busy || !password} onClick={()=>run(async()=>{
            const result = await api("/auth/recovery-key",{password}); setRecoveryKey(result.recoveryKey);setPassword("");
          })}>أنشئ مفتاح استعادة جديد</Button>
          <hr />
          <Button
            secondary
            onClick={() =>
              run(async () => {
                await api("/auth/logout", {});
                setToken("");
                setRecoveryKey("");
                await refreshMe();
              })
            }
          >
            <LogOut size={17} />
            تسجيل الخروج
          </Button>
        </div>
      )}
      {recoveryKey && <div className="setup-panel recovery-key" role="status">
        <h2>احفظ مفتاحك الآن</h2><p>لن يُعرض مجددًا. لا تشاركه مع أحد. بعد استعادة الحساب سجّل الدخول بكلمة المرور الجديدة.</p>
        <output dir="ltr">{recoveryKey}</output>
        <Button secondary onClick={()=>{
          const blob = new Blob([`Nabeeh recovery key for ${me.username || username}\n${recoveryKey}\nKeep private. Single use, expires in one year.\n`],{type:"text/plain"});
          const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="nabeeh-recovery-key.txt";a.click();URL.revokeObjectURL(url);
        }}>تنزيل مفتاح الاستعادة</Button>
        <Button secondary onClick={()=>setRecoveryKey("")}>حفظت المفتاح</Button>
      </div>}
      <div className="privacy-actions">
        <a className="text-button" href="/api/account/export" download>
          <Download size={17} />
          تنزيل بياناتي
        </a>
        <button
          className="text-button danger"
          onClick={() =>
            run(async () => {
              if (
                !(await confirm(
                  "حذف ملفك نهائيًا؟ ستفقد الوصول إلى ألعابك وسجلّك. سجلّ المشاركين الآخرين يبقى محفوظًا.",
                ))
              )
                return;
              const pass = me.userId
                ? window.prompt("أدخل كلمة المرور لتأكيد الحذف")
                : undefined;
              if (me.userId && !pass) return;
              await api(
                "/account",
                { confirm: "DELETE", password: pass },
                "DELETE",
              );
              await refreshMe();
            })
          }
        >
          حذف ملفي
        </button>
      </div>
      <p className="muted">
        لا نستخدم بصمة الجهاز. اقرأ{" "}
        <button className="inline-link" onClick={() => navigate("/privacy")}>
          سياسة الخصوصية
        </button>
        .
      </p>
    </section>
  );
}
function Admin({ me, run, busy, confirm, refreshMe }: Context) {
  const [overview, setOverview] = useState<any>(null),
    [note, setNote] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [payload, setPayload] = useState(""),
    [category, setCategory] = useState("logic"),
    [kind, setKind] = useState("arithmetic"),
    [questions, setQuestions] = useState<any[]>([]),
    [tab, setTab] = useState("review"),
    [categoryJson, setCategoryJson] = useState(""),
    [editJson, setEditJson] = useState(""),
    [verificationJson, setVerificationJson] = useState(""),
    [metrics, setMetrics] = useState<any>(null),
    [access, setAccess] = useState<any[]>([]),
    [draftId,setDraftId]=useState(""),[draftJson,setDraftJson]=useState(""),[draftRevision,setDraftRevision]=useState(1);
  const load = async () => {
    setOverview(await api("/admin/overview"));
    setQuestions(await api("/admin/questions"));
    setMetrics(await api("/admin/metrics"));
    if (me?.role === "admin") setAccess(await api("/admin/access"));
  };
  useEffect(() => {
    if (["admin", "editor"].includes(me?.role || "")) run(load);
  }, []);
  if (!["admin", "editor"].includes(me?.role || ""))
    return (
      <section className="section container">
        <Empty>هذه الصفحة للمحرّرين المعتمدين فقط.</Empty>
      </section>
    );
  return (
    <section className="section container admin-page">
      <div className="page-heading">
        <div className="eyebrow">كل سؤال يستحق مراجعة</div>
        <h1>غرفة التحرير</h1>
        <p>لا ينتقل أي سؤال مولّد إلى اللعب قبل مراجعة المصادر والتشابه.</p>
        <Button secondary disabled={busy} onClick={()=>run(load)}>حدّث قائمة المراجعة</Button>
      </div>
      <div className="admin-stats">
        {overview?.questions.map((s: any) => (
          <div key={s.status}>
            <strong>{s.count}</strong>
            <span>
              {s.status === "approved" ? "أسئلة في المكتبة" : s.status}
            </span>
          </div>
        ))}
        <div>
          <strong>
            {overview?.candidates.filter((c: any) => c.status === "review")
              .length || 0}
          </strong>
          <span>بانتظار المراجعة</span>
        </div>
        <div>
          <strong>
            {overview?.jobs.filter((j: any) => j.status === "failed").length ||
              0}
          </strong>
          <span>مهام فشلت</span>
        </div>
        <div>
          <strong>
            {overview?.reports.filter((r: any) => r.status === "open").length ||
              0}
          </strong>
          <span>بلاغات مفتوحة</span>
        </div>
      </div>
      <div className="tabs admin-tabs">
        {[
          ["review", "مراجعة المحتوى"],
          ["questions", "المكتبة"],
          ["generate", "التوليد والاستيراد"],
          ["metrics", "المخزون والسجلّ"],
          ...(me?.role === "admin" ? [["access", "إدارة الوصول"]] : []),
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={tab === v ? "chosen" : ""}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "review" && (
        <>
          {draftId && <div className="setup-panel">
            <h2>تعديل المسودة قبل الاعتماد</h2><label htmlFor="candidate-draft">محتوى المسودة</label><textarea id="candidate-draft" dir="ltr" className="json-input" value={draftJson} onChange={e=>setDraftJson(e.target.value)} />
            <p>أدخل سبب التعديل في ملاحظة التحقّق أدناه. نعيد فحص التشابه، وتبقى المسودة خارج اللعب.</p>
            <Button disabled={busy || note.trim().length<12} onClick={()=>run(async()=>{
              await api(`/admin/candidates/${draftId}/edit`,{candidate:JSON.parse(draftJson),reason:note,expectedRevision:draftRevision});setDraftId("");setDraftJson("");await load();
            })}>حفظ المسودة</Button>
            <Button secondary onClick={()=>setDraftId("")}>إلغاء التعديل</Button>
          </div>}
          <div className="setup-panel">
            <label>
              ملاحظة التحقّق التحريرية (تُحفظ في سجلّ التدقيق)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="المصدر الدقيق، طريقة التحقّق، وحسم التشابه…"
                minLength={12}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              راجعت مرشّحات التشابه، والحقيقة مستقلة فعلًا
            </label>
          </div>
          <div className="review-list">
            {overview?.candidates.map((c: any) => (
              <article className="setup-panel" key={c.id}>
                <div className="panel-title">
                  <h2>{c.payload.text}</h2>
                  <span className="status-badge">
                    {c.status === "review"
                      ? "مراجعة"
                      : c.status === "approved"
                        ? "معتمد"
                        : c.status === "duplicate"
                          ? "مكرّر"
                          : "مرفوض"}
                  </span>
                </div>
                <p>
                  <strong>الإجابة:</strong> {c.payload.answer}
                </p>
                <p>{c.payload.explanation}</p>
                <p className="muted">
                  الصعوبة: {difficulties.find(([value])=>value===c.payload.difficulty)?.[1] || c.payload.difficulty}
                  {" · "}النوع: {({text:"نص",choice:"اختيارات",ordering:"ترتيب",word:"كلمة",image:"صورة",audio:"صوت",video:"فيديو"} as Record<string,string>)[c.payload.format] || c.payload.format}
                </p>
                <code>{c.fact_key}</code>
                {["review","duplicate"].includes(c.status) && <Button secondary disabled={busy} onClick={()=>{setDraftId(c.id);setDraftRevision(c.revision);setDraftJson(JSON.stringify(c.payload,null,2));window.scrollTo({top:0,behavior:"smooth"});}}>تعديل المسودة</Button>}
                {c.payload.media && <figure className="question-media">
                  {c.payload.format === "image" ? <img src={`/api/admin/media/${c.payload.media.assetId}`} alt={c.payload.media.alt} />
                    : c.payload.format === "audio" ? <audio controls preload="none" aria-label={c.payload.media.alt} src={`/api/admin/media/${c.payload.media.assetId}`} />
                    : <video controls muted playsInline preload="none" aria-label={c.payload.media.alt} src={`/api/admin/media/${c.payload.media.assetId}`} />}
                  <figcaption>{c.payload.media.transcript}</figcaption>
                </figure>}
                {c.payload.sources?.map((s: any) => (
                  <p key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.url}
                    </a>{" "}
                    — {s.citation}
                  </p>
                ))}
                {c.payload.deterministic && (
                  <p>دليل قابل للتحقّق: {c.payload.fact}</p>
                )}
                {c.duplicates.length > 0 && (
                  <details>
                    <summary>
                      أسئلة قد تختبر الحقيقة نفسها ({c.duplicates.length})
                    </summary>
                    {c.duplicates.map((d: any) => (
                      <p key={d.id}>
                        {d.text} — {d.answer} ({Math.round(d.score * 100)}%)
                      </p>
                    ))}
                  </details>
                )}
                {c.status === "review" && (
                  <div className="actions">
                    <Button
                      disabled={
                        busy ||
                        note.trim().length < 12 ||
                        (c.duplicates.length > 0 && !reviewed)
                      }
                      onClick={() =>
                        run(async () => {
                          if (
                            await confirm(
                              "اعتماد هذا السؤال للمكتبة العامة؟ تأكّد من صحة المصادر واستقلال الحقيقة.",
                            )
                          ) {
                            await api("/admin/candidates/" + c.id + "/review", {
                              action: "approve",
                              verificationNote: note,
                              expectedRevision:c.revision,
                              duplicateReviewed: reviewed,
                            });
                            await load();
                          }
                        })
                      }
                    >
                      اعتماد
                    </Button>
                    <Button
                      secondary
                      disabled={busy || note.trim().length < 12}
                      onClick={() =>
                        run(async () => {
                          await api("/admin/candidates/" + c.id + "/review", {
                            action: "reject",
                            verificationNote: note,
                            expectedRevision:c.revision,
                          });
                          await load();
                        })
                      }
                    >
                      رفض
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {overview && !overview.candidates.length && (
            <Empty>
              قائمة المراجعة فارغة. استورد أسئلة أو شغّل مهمة توليد.
            </Empty>
          )}
        </>
      )}
      {tab === "questions" && (
        <>
          <div className="setup-panel">
            <h2>اعتماد مصادر سؤال للإطلاق</h2>
            <p>
              افتح المصدر المحدّد وتحقّق من الحقيقة والإجابة. الاعتماد يرفع
              السؤال من المكتبة التجريبية إلى الإنتاج ويحفظ هوّيته وسجلّ
              المشاهدة. أدخل id,sources:[&#123;url,citation&#125;],note، أو
              verifiedFact لحساب يطابق الإجابة.
            </p>
            <label>
              بيانات التحقّق
              <textarea
                className="json-input"
                dir="ltr"
                value={verificationJson}
                onChange={(e) => setVerificationJson(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || !verificationJson}
              onClick={() =>
                run(async () => {
                  if (
                    !(await confirm(
                      "اعتماد السؤال للإنتاج بعد التحقّق من مصادره؟ لا يغيّر هذا سجلّ المشاهدة.",
                    ))
                  )
                    return;
                  const { id, ...data } = JSON.parse(verificationJson);
                  await api("/admin/questions/" + id + "/verify", data);
                  setVerificationJson("");
                  await load();
                })
              }
            >
              اعتماد مصادر الإطلاق
            </Button>
          </div>
          <div className="setup-panel">
            <h2>تصحيح سؤال مع حفظ هويّته</h2>
            <p>
              عدّل الصياغة والفئات دون تغيير الحقيقة أو حذف سجلّ المشاهدة. أدخل
              JSON يحوي
              id,text,answer,aliases,explanation,hint,categoryIds,reason.
            </p>
            <label>
              بيانات التصحيح
              <textarea
                className="json-input"
                dir="ltr"
                value={editJson}
                onChange={(e) => setEditJson(e.target.value)}
              />
            </label>
            <Button
              secondary
              disabled={busy || !editJson}
              onClick={() =>
                run(async () => {
                  const { id, ...data } = JSON.parse(editJson);
                  await api("/admin/questions/" + id + "/edit", data);
                  setEditJson("");
                  await load();
                })
              }
            >
              حفظ التصحيح
            </Button>
          </div>
          <div className="review-list">
            {questions.map((q) => (
              <article className="setup-panel" key={q.id}>
                <div className="panel-title">
                  <h2>{q.text}</h2>
                  <span>{q.status}</span>
                </div>
                <p>
                  {q.answer} · {q.difficulty}
                </p>
                <code>{q.fact_key}</code>
                {q.status === "approved" && (
                  <div className="actions">
                    <Button
                      secondary
                      onClick={() =>
                        run(async () => {
                          if (
                            await confirm(
                              "أرشفة السؤال ومنعه من الألعاب الجديدة؟",
                            )
                          ) {
                            await api("/admin/questions/" + q.id + "/status", {
                              status: "archived",
                              reason: "Archived by editor after review",
                            });
                            await load();
                          }
                        })
                      }
                    >
                      أرشفة
                    </Button>
                    <Button
                      secondary
                      onClick={() =>
                        run(async () => {
                          if (await confirm("إحالة السؤال للتقاعد نهائيًا؟")) {
                            await api("/admin/questions/" + q.id + "/status", {
                              status: "retired",
                              reason: "Retired by editor after review",
                            });
                            await load();
                          }
                        })
                      }
                    >
                      تقاعد
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "generate" && (
        <>
          <MediaUploader run={run} busy={busy} />
          <div className="setup-panel">
            <h2>مهمة توليد خلفية</h2>
            <div className="setup-filters">
              <label>
                الفئة
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {overview?.inventory.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                المصدر
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="arithmetic">مولّد ألغاز حسابية</option>
                  <option value="model">نموذج لغوي (يحتاج إعداد الخادم)</option>
                </select>
              </label>
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/admin/jobs", {
                    categoryId: category,
                    kind,
                    count: 6,
                  });
                  await load();
                })
              }
            >
              أضف مهمة للمراجعة <Plus size={17} />
            </Button>
            <p className="muted">
              المولّد الحسابي متاح للألغاز فقط. يعمل العامل بأمر npm run worker.
              المخرجات تبقى بانتظار المراجعة.
            </p>
          </div>
          <div className="setup-panel">
            <h2>إضافة أو استيراد أسئلة</h2>
            <p>
              أدخل سؤالًا أو مصفوفة JSON وفق عقد Candidate في docs/content.md.
              كل عنصر يمرّ بفحص التكرار والمراجعة.
            </p>
            <label>
              JSON
              <textarea
                className="json-input"
                dir="ltr"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder='{"text":"…","answer":"…","factKey":"…"}'
              />
            </label>
            <div className="actions">
              <Button
                disabled={busy || !payload}
                onClick={() =>
                  run(async () => {
                    const data = JSON.parse(payload);
                    await api(
                      Array.isArray(data)
                        ? "/admin/import"
                        : "/admin/candidates",
                      data,
                    );
                    setPayload("");
                    await load();
                  })
                }
              >
                إرسال للمراجعة
              </Button>
              <a href="/api/admin/export" className="text-button" download>
                <Download size={16} />
                تصدير المرشّحات
              </a>
            </div>
          </div>
          <div className="setup-panel">
            <h2>إضافة أو تعديل فئة</h2>
            <label>
              JSON للفئة
              <textarea
                className="json-input"
                dir="ltr"
                value={categoryJson}
                onChange={(e) => setCategoryJson(e.target.value)}
                placeholder='{"id":"new-category","name":"الفئة","description":"وصف الفئة","region":"all","tags":[]}'
              />
            </label>
            <Button
              secondary
              disabled={busy || !categoryJson}
              onClick={() =>
                run(async () => {
                  await api("/admin/categories", JSON.parse(categoryJson));
                  setCategoryJson("");
                  await load();
                })
              }
            >
              حفظ الفئة
            </Button>
          </div>
        </>
      )}
      {tab === "metrics" && (
        <>
          <div className="setup-panel"><h2>طلبات محتوى جديد</h2>
            {overview?.replenishment.length ? overview.replenishment.map((r:any)=><div className="report-row" key={r.category_id+":"+r.difficulty+":"+r.region}>
              <span>{r.name} · {r.difficulty} · {r.region}</span>
              <Button secondary disabled={busy} onClick={()=>run(async()=>{await api("/admin/replenishment/resolve",{categoryId:r.category_id,difficulty:r.difficulty,region:r.region});await load();})}>تمّت متابعة الطلب</Button>
            </div>) : <p>لا توجد طلبات معلّقة.</p>}
          </div>
          <div className="setup-panel">
            <h2>استخدام المنصّة وجودة المحتوى</h2>
            <div className="inventory-grid">
              <div>
                <strong>الأسئلة المعروضة</strong>
                <span>{metrics?.exposures.shown || 0}</span>
              </div>
              <div>
                <strong>الأسئلة المكتملة</strong>
                <span>{metrics?.exposures.completed || 0}</span>
              </div>
              {metrics?.content.map((c: any) => (
                <div key={c.status}>
                  <strong>{c.status}</strong>
                  <span>{c.count} مرشّحًا</span>
                </div>
              ))}
              {metrics?.games.map((g: any) => (
                <div key={g.mode + g.status}>
                  <strong>
                    {g.mode} · {g.status}
                  </strong>
                  <span>{g.count} لعبة</span>
                </div>
              ))}
            </div>
            <p>
              المقاييس مجمّعة ولا تعرض سجلّ الأفراد. حجز ميزانية التوليد آخر ٣٠
              يومًا:{" "}
              {metrics?.budget.reduce(
                (sum: number, b: any) => sum + b.reserved_cents,
                0,
              ) || 0}{" "}
              سنت. الحجز حدّ تقديري، وليس فاتورة المزوّد.
            </p>
          </div>
          <div className="setup-panel">
            <h2>المخزون المعتمد</h2>
            <div className="inventory-grid">
              {overview?.inventory.map((c: any) => (
                <div key={c.id}>
                  <strong>{c.name}</strong>
                  <span>
                    {c.total} سؤالًا {c.total < 6 ? "— يحتاج محتوى جديدًا" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="setup-panel">
            <h2>مهام التوليد</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الفئة</th>
                    <th>الحالة</th>
                    <th>المحاولات</th>
                    <th>حجز الميزانية</th>
                    <th>الملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.jobs.map((j: any) => (
                    <tr key={j.id}>
                      <td>{j.category_id}</td>
                      <td>{j.status}</td>
                      <td>{j.attempts}</td>
                      <td>{j.cost_cents} سنت</td>
                      <td>{j.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="setup-panel">
            <h2>بلاغات الجودة</h2>
            {overview?.reports.map((r: any) => (
              <div key={r.id} className="report-row">
                <p>
                  {r.reason} — {r.status}
                </p>
                {r.status === "open" && (
                  <Button
                    secondary
                    onClick={() =>
                      run(async () => {
                        await api("/admin/reports/" + r.id + "/resolve", {});
                        await load();
                      })
                    }
                  >
                    إغلاق البلاغ
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="setup-panel">
            <h2>سجلّ التدقيق</h2>
            {overview?.audit.map((a: any) => (
              <p key={a.id}>
                {a.action} · {new Date(a.created_at).toLocaleString("ar-SA")} ·{" "}
                <code>{a.target}</code>
              </p>
            ))}
          </div>
          <Button secondary onClick={() => run(load)}>
            <RotateCcw size={16} />
            تحديث البيانات
          </Button>
        </>
      )}
      {tab === "access" && me?.role === "admin" && (
        <div className="setup-panel">
          <h2>المستخدمون والصلاحيات</h2>
          <p>
            اللاعب يشارك فقط، المحرّر يدير المحتوى، والمدير يدير الوصول. كل
            تغيير يُسجّل في التدقيق.
          </p>
          {access.map((u: any) => (
            <div key={u.id} className="report-row">
              <div>
                <strong>{u.username}</strong>
                <p>{u.role}</p>
              </div>
              <div className="actions">
                {["player", "editor", "admin"].map((role) => (
                  <Button
                    key={role}
                    secondary
                    disabled={busy || u.role === role}
                    onClick={() =>
                      run(async () => {
                        if (
                          !(await confirm(
                            `تغيير صلاحية ${u.username} إلى ${role}؟`,
                          ))
                        )
                          return;
                        await api("/admin/access/" + u.id, {
                          role,
                          reason:
                            "Role changed by authorized administrator in access dashboard.",
                        });
                        await refreshMe();
                        if (u.id === me.userId && role !== "admin") {
                          navigate("/account");
                          return;
                        }
                        await load();
                      })
                    }
                  >
                    {role === "player"
                      ? "لاعب"
                      : role === "editor"
                        ? "محرّر"
                        : "مدير"}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function MediaUploader({run,busy}:Pick<Context,"run"|"busy">) {
  const [file,setFile]=useState<File|null>(null),[credit,setCredit]=useState(""),[license,setLicense]=useState(""),[source,setSource]=useState(""),[assetId,setAssetId]=useState("");
  return <form className="setup-panel" onSubmit={e=>{e.preventDefault();run(async()=>{
    if(!file) return;
    const response=await fetch("/api/admin/media",{method:"POST",headers:{"Content-Type":file.type === "audio/x-wav" ? "audio/wav" : file.type,"X-Nabeeh-Request":"1","X-Media-Credit":encodeURIComponent(credit),"X-Media-License":encodeURIComponent(license),...(source?{"X-Media-Source":encodeURIComponent(source)}:{})},body:file});
    const data=await response.json();if(!response.ok)throw new Error(data.message || "تعذّر رفع الملف.");setAssetId(data.id);
  });}}>
    <h2>وسائط مرخّصة للسؤال</h2><p>للملفات الجديدة، جهّز تخزين الوسائط أولًا. وسائط الحزمة الأصلية جاهزة للمراجعة. أضف بديلًا نصّيًا للصوت والفيديو في مسودة السؤال.</p>
    <label>ملف الوسائط<input type="file" required accept="image/png,image/jpeg,image/webp,audio/wav,audio/ogg,video/mp4,video/webm" onChange={e=>setFile(e.target.files?.[0] || null)} /><small>الحد الأقصى ١٠ ميغابايت.</small></label>
    <label>صاحب العمل أو بيان الإسناد<input required minLength={3} value={credit} onChange={e=>setCredit(e.target.value)} /></label>
    <label>الترخيص وإذن الاستخدام<input required minLength={3} value={license} onChange={e=>setLicense(e.target.value)} /></label>
    <label>رابط المصدر<input type="url" dir="ltr" value={source} onChange={e=>setSource(e.target.value)} /></label>
    <Button type="submit" disabled={busy || !file}>رفع الوسائط</Button>
    {assetId && <p>معرّف الوسائط لإضافته إلى المسودة: <code dir="ltr">{assetId}</code></p>}
  </form>;
}
function Privacy() {
  return (
    <article className="section container prose">
      <h1>الخصوصية وسجلّ الأسئلة</h1>
      <p>
        نحفظ ملف تعريف عشوائيًا، جلسة آمنة، الألعاب، المفضّلة، وسجلّ الأسئلة
        المعروضة. لا نستخدم بصمة الجهاز، ولا نطلب اسمًا حقيقيًا أو رقم هاتف.
      </p>
      <h2>ضيف أم حساب؟</h2>
      <p>
        ملف الضيف يرتبط بملف ارتباط HTTP-only في هذا المتصفح لمدة ١٨٠ يومًا.
        البيانات على الخادم لا تُحذف تلقائيًا عند انتهاء الجلسة. إنشاء حساب يحفظ
        الوصول عبر الأجهزة. حذف بيانات المتصفح قد يفقد الضيف الوصول إلى السجلّ.
        أسماء اللاعبين في الإعداد بيانات عرض ولا تربط حساباتهم.
      </p>
      <h2>اللعب المشترك</h2>
      <p>
        يُسجّل السؤال للمضيف ولكل مشارك ربط ملفه برمز مشاركة. لا نعرض سجلّ
        المشاركين للمضيف. الرمز لمرة واحدة وينتهي بعد عشر دقائق.
      </p>
      <h2>الاحتفاظ والتحكّم</h2>
      <p>
        لا نعيد ضبط سجلّ المشاهدة تلقائيًا. يُحفظ إلى أن تطلب حذف ملفك من
        «حسابي». يمكنك تنزيل بياناتك. حذف المضيف لا يمحو سجلّ المشاهدة لدى
        المشاركين الآخرين. قد تبقى أحداث تدقيق منزوعة الهوية والنسخ الاحتياطية
        حتى انتهاء دورة احتفاظ المشغّل.
      </p>
      <h2>المحتوى المولّد</h2>
      <p>
        مزوّد النموذج، إن فُعّل، يتلقّى طلبات تحرير محتوى فقط دون بيانات
        اللاعبين أو سجلّهم. لا نولّد أسئلة أثناء اللعب. المكتبة التجريبية تحتاج
        مراجعة مصادر قبل الإطلاق العام.
      </p>
      <h2>التشغيل العام</h2>
      <p>
        على مشغّل النسخة المنشورة تحديد جهة التواصل، مكان الاستضافة، سياسة
        الاحتفاظ بالنسخ الاحتياطية، وشروط الخدمة قبل استقبال المستخدمين. لا توجد
        أدوات تتبّع إعلانية أو مدفوعات في هذه النسخة.
      </p>
    </article>
  );
}
