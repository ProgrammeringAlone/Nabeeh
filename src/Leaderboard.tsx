import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Trophy, Users } from "lucide-react";
import "./Leaderboard.css";

type View = "players" | "teams";
type Metric = "points" | "games" | "wins";
type Entry = { rank: number; name: string; hostUsername?: string; points: number; games: number; wins: number };
type Page = { entries: Entry[]; page: number; pageSize: number; total: number; totalPages: number };
export type LeaderboardProps = { isSignedIn?: boolean; onError?: (message: string) => void };
const metricNames: Record<Metric, string> = { points: "إجمالي النقاط", games: "الألعاب المكتملة", wins: "مرات الفوز" };
const number = new Intl.NumberFormat("ar-SA");

async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", signal,
      headers: { "Content-Type": "application/json", "X-Nabeeh-Request": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("تعذّر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.");
  }
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error("الخادم لم يجهز بعد. انتظر قليلًا ثم حاول مرة أخرى."); }
  if (!response.ok) throw new Error(data.message || "تعذّر تحميل لوحة الصدارة. حاول مرة أخرى.");
  return data;
}

export default function Leaderboard({ isSignedIn = false, onError }: LeaderboardProps) {
  const [view, setView] = useState<View>("players");
  const [metric, setMetric] = useState<Metric>("points");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [preferenceReady, setPreferenceReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [preferenceRefresh, setPreferenceRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    request<Page>(`/leaderboard?view=${view}&metric=${metric}&page=${page}`, controller.signal)
      .then(setData)
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, metric, page, refresh]);

  useEffect(() => {
    setPreferenceReady(false); setNotice("");
    if (!isSignedIn) { setEnabled(false); return; }
    const controller = new AbortController();
    request<{ enabled: boolean }>("/account/leaderboard", controller.signal)
      .then(result => { setEnabled(result.enabled); setPreferenceReady(true); })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setNotice(cause.message);
      });
    return () => controller.abort();
  }, [isSignedIn, preferenceRefresh]);

  async function changePreference(next: boolean) {
    setSaving(true); setNotice("");
    try {
      const result = await request<{ enabled: boolean }>("/account/leaderboard", undefined, { enabled: next });
      setEnabled(result.enabled);
      setNotice(next ? "تم تفعيل ظهورك. تُحتسب ألعابك المكتملة المرتبطة بفريقك." : "تم إخفاء حسابك وفرقك من لوحة الصدارة.");
      setPage(1); setRefresh(value => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "تعذّر حفظ اختيارك.";
      setNotice(message); onError?.(message);
    } finally { setSaving(false); }
  }

  return <section className="leaderboard container" dir="rtl" aria-labelledby="leaderboard-title">
    <div className="leaderboard-heading">
      <div><p className="leaderboard-eyebrow"><Trophy size={18} aria-hidden="true" /> كل جولة تضيف إلى رصيدك</p>
        <h1 id="leaderboard-title">لوحة الصدارة</h1>
        <p>تعرّف على أكثر اللاعبين والفرق جمعًا للنقاط، ولعبًا، وفوزًا.</p></div>
      <div className="leaderboard-emblem" aria-hidden="true"><Trophy size={58} strokeWidth={1.4} /></div>
    </div>

    <aside className="leaderboard-privacy" aria-label="الظهور في لوحة الصدارة">
      <div><h2>شارك إنجازاتك باختيارك</h2>
        <p>يظهر اسم المستخدم ونتائجه فقط عند تفعيل المشاركة. وتظهر الفرق التي تستضيف ألعابها مع اسم المستخدم الخاص بك. يمكنك إخفاؤها في أي وقت.</p></div>
      {isSignedIn ? <label className="leaderboard-switch">
        <input type="checkbox" role="switch" checked={enabled} disabled={!preferenceReady || saving}
          onChange={event => void changePreference(event.target.checked)} />
        <span aria-hidden="true" className="leaderboard-switch-track"><span /></span>
        <span>{saving ? "جارٍ الحفظ…" : "إظهار حسابي وفرقي"}</span>
      </label> : <a className="leaderboard-signin" href="#/account">سجّل الدخول للمشاركة <ArrowLeft size={18} aria-hidden="true" /></a>}
      {notice && <p className="leaderboard-notice" role="status">{notice}</p>}
      {isSignedIn && notice && !preferenceReady && <button className="leaderboard-preference-retry" onClick={() => setPreferenceRefresh(value => value + 1)}>أعد تحميل إعداد المشاركة</button>}
    </aside>

    <div className="leaderboard-controls">
      <div className="leaderboard-segments" role="group" aria-label="نوع الترتيب">
        <button aria-pressed={view === "players"} onClick={() => { setView("players"); setPage(1); }}><Users size={18} aria-hidden="true" /> اللاعبون</button>
        <button aria-pressed={view === "teams"} onClick={() => { setView("teams"); setPage(1); }}><Trophy size={18} aria-hidden="true" /> الفرق</button>
      </div>
      <div className="leaderboard-metrics" role="group" aria-label="رتّب حسب">
        {(Object.keys(metricNames) as Metric[]).map(key => <button key={key} aria-pressed={metric === key}
          onClick={() => { setMetric(key); setPage(1); }}>{metric === key && <Check size={16} aria-hidden="true" />}{metricNames[key]}</button>)}
      </div>
    </div>

    <div className="leaderboard-results" aria-busy={loading}>
      <p className="leaderboard-result-caption" aria-live="polite">{loading ? "جارٍ تحميل الترتيب…" : error ? "" : `${number.format(data?.total || 0)} ${view === "players" ? "لاعبًا" : "فريقًا"} · الترتيب حسب ${metricNames[metric]}`}</p>
      {error ? <div className="leaderboard-empty" role="alert"><p>{error}</p><button onClick={() => setRefresh(value => value + 1)}>حاول مرة أخرى</button></div>
        : data?.entries.length ? <table className="leaderboard-table">
          <caption className="leaderboard-sr-only">ترتيب {view === "players" ? "اللاعبين" : "الفرق"} حسب {metricNames[metric]}</caption>
          <thead><tr><th scope="col">الترتيب</th><th scope="col">{view === "players" ? "اللاعب" : "الفريق"}</th><th scope="col">النقاط</th><th scope="col">الألعاب</th><th scope="col">مرات الفوز</th></tr></thead>
          <tbody>{data.entries.map((entry, index) => <tr key={`${page}-${index}`}>
            <td><span className={"leaderboard-rank " + (entry.rank <= 3 ? "leaderboard-rank-top" : "")}>{number.format(entry.rank)}</span></td>
            <th scope="row"><bdi>{entry.name}</bdi>{entry.hostUsername && <small>المضيف: <bdi>{entry.hostUsername}</bdi></small>}</th>
            <td data-label="النقاط" className={metric === "points" ? "leaderboard-selected" : ""}>{number.format(entry.points)}</td>
            <td data-label="الألعاب" className={metric === "games" ? "leaderboard-selected" : ""}>{number.format(entry.games)}</td>
            <td data-label="مرات الفوز" className={metric === "wins" ? "leaderboard-selected" : ""}>{number.format(entry.wins)}</td>
          </tr>)}</tbody>
        </table> : !loading && <div className="leaderboard-empty"><Trophy size={36} aria-hidden="true" />
          <h2>أول اسم في الصدارة قد يكون اسمك</h2><p>فعّل المشاركة وأكمل لعبة بعد اختيار فريقك لتظهر نتائجك هنا.</p>
          <a href="#/setup">ابدأ لعبة <ArrowLeft size={18} aria-hidden="true" /></a></div>}
      {data && data.totalPages > 1 && !error && <nav className="leaderboard-pagination" aria-label="صفحات لوحة الصدارة">
        <button disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}><ArrowRight size={18} aria-hidden="true" /> السابقة</button>
        <span>صفحة {number.format(page)} من {number.format(data.totalPages)}</span>
        <button disabled={loading || page >= data.totalPages} onClick={() => setPage(value => value + 1)}>التالية <ArrowLeft size={18} aria-hidden="true" /></button>
      </nav>}
    </div>
    <div className="leaderboard-rules"><h2>كيف تُحتسب النتائج؟</h2>
      <p>تُحتسب الألعاب المكتملة فقط، ويحدّد المضيف صحة الإجابات أثناء اللعب. يحصل كل مشارك مرتبط بحساب وفريق على نقاط فريقه كاملة ونتيجة فوزه؛ هذه نقاط جماعية وليست تقييمًا فرديًا. لا يُحتسب التعادل انتصارًا.</p>
      <p>تُجمع نتائج الفريق تحت اسم مضيفه. الفرق المتشابهة في الاسم لدى مضيفين مختلفين تبقى منفصلة. لا تُحتسب الألعاب القديمة التي لم يُحدَّد فيها فريق المشارك ضمن ترتيب اللاعبين.</p>
      <p>اربط حساب المشارك بفريقه قبل بدء اللعبة باستخدام رمز المشاركة. كتابة اسم اللاعب وحده لا تربط نتائج اللعبة بحسابه.</p>
    </div>
  </section>;
}
