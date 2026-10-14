import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.ts";
import { ingest, candidateSchema } from "./content.ts";
import { providerFetch } from "./http.ts";
import {EventEmitter} from "node:events";
import {integerSetting} from "./config.ts";
const wakes=new EventEmitter();
export function wakeWorker() { wakes.emit("wake"); }
export function startEmbeddedWorker() {
  let stopping=false,active:Promise<void>|null=null,again=false,timer:NodeJS.Timeout|undefined;
  const controller=new AbortController();
  const drain=()=>{
    if(stopping)return;
    if(active){again=true;return;}
    if(timer){clearTimeout(timer);timer=undefined;}
    active=(async()=>{
      let consumed=0;
      let retry:number|undefined;
      try {
        for(;consumed<20 && !stopping;consumed++) if(!await runJob(controller.signal)) break;
        if(!stopping && consumed<20) {
          const {rows:[pending]}=await pool.query("SELECT EXTRACT(EPOCH FROM MIN(leased_at)+interval '5 minutes'-now()) AS seconds FROM generation_jobs WHERE status='running'");
          if(pending.seconds!==null)retry=Math.max(1000,Number(pending.seconds)*1000+1000);
        }
      }
      catch {retry=60000;console.error(JSON.stringify({level:"error",code:"WORKER_FAILED"}));}
      finally {
        active=null;
        if(!stopping) {
          if(again || consumed===20){again=false;setImmediate(drain);}
          else if(retry!==undefined){timer=setTimeout(drain,retry);timer.unref();}
        }
      }
    })();
  };
  wakes.on("wake",drain);setImmediate(drain);
  return async()=>{stopping=true;if(timer)clearTimeout(timer);controller.abort();wakes.off("wake",drain);await active;};
}
export async function runJob(signal?:AbortSignal) {
  const job = await transaction(async (db) => {
    await db.query(
      "UPDATE generation_jobs SET status=CASE WHEN attempts<max_attempts THEN 'queued' ELSE 'failed' END,error='Lease expired',lease_token=null WHERE status='running' AND leased_at<now()-interval '5 minutes'",
    );
    const {
      rows: [j],
    } = await db.query(
      "SELECT * FROM generation_jobs WHERE status='queued' AND attempts<max_attempts ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!j) return null;
    const reserve = j.kind === "model" ? 50 : 0;
    const {
      rows: [budget],
    } = await db.query(
      "INSERT INTO generation_budget(day,reserved_cents) VALUES(current_date,$1) ON CONFLICT(day) DO UPDATE SET reserved_cents=generation_budget.reserved_cents+$1 RETURNING reserved_cents",
      [reserve],
    );
    if (
      reserve > 0 && budget.reserved_cents >
      integerSetting("GENERATION_DAILY_BUDGET_CENTS",200,0,100000)
    ) {
      await db.query(
        "UPDATE generation_budget SET reserved_cents=reserved_cents-$1 WHERE day=current_date",
        [reserve],
      );
      await db.query(
        "UPDATE generation_jobs SET status='failed',error='Daily budget exhausted' WHERE id=$1",
        [j.id],
      );
      return {...j,blocked:true};
    }
    const leaseToken=randomUUID();
    await db.query("UPDATE generation_jobs SET status='running',attempts=attempts+1,leased_at=now(),cost_cents=cost_cents+$2,lease_token=$3 WHERE id=$1",[j.id,reserve,leaseToken]);
    return {...j,leaseToken};
  });
  if (!job) return false;
  if (job.blocked) return true;
  try {
    if (job.kind === "arithmetic") {
      for (let i = 0; i < job.count; i++) {
        const a = 3 + Math.floor(Math.random() * 60),
          b = 3 + Math.floor(Math.random() * 60),
          offset = 1 + Math.floor(Math.random() * 30),
          product = a * b + offset;
        await ingest({
          text: `صندوق فيه ${a} صفوف، في كل صف ${b} قطعة، وأضفنا ${offset} قطع. كم قطعة فيه الآن؟`,
          answer: String(product),
          explanation: `${a} × ${b} + ${offset} = ${product}.`,
          hint: "احسب حاصل الضرب ثم أضف القطع المتبقية.",
          factKey: `arithmetic:multiply-add:${Math.min(a, b)}:${Math.max(a, b)}:${offset}`,
          subject: `${Math.min(a, b)},${Math.max(a, b)},${offset}`,
          predicate: "multiply-add",
          fact: `${a}*${b}+${offset}=${product}`,
          categoryIds: ["logic"],
          difficulty:
            product > 1000 ? "hard" : product > 200 ? "medium" : "easy",
          deterministic: true,
          provenance:
            "Original deterministic generator v1. Reviewed before publication.",
        });
      }
    } else {
      if (!process.env.MODEL_API_KEY)
        throw new Error(
          "MODEL_API_KEY is not configured; gameplay remains independent.",
        );
      const base = new URL(
        process.env.MODEL_BASE_URL || "https://api.openai.com/v1",
      );
      if (base.protocol !== "https:")
        throw new Error("Model provider must use HTTPS");
      const r = await providerFetch(
        base.href.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
          headers: {
            Authorization: `Bearer ${process.env.MODEL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.MODEL_NAME || "gpt-4.1-mini",
            temperature: 0.6,
            max_tokens: 5000,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "Produce original Arabic trivia candidates only, never approved content. Return JSON {questions:[...]}. Each question: text,answer,aliases,explanation,hint,factKey,subject,predicate,fact,categoryIds,difficulty(easy/medium/hard/expert),format(text),region(all/sa/kw/ae/bh/qa/om),tags,sources[{url,citation}],provenance. Sources are proposed evidence, not verified. No invented quotations, sensitive claims or copyrighted question banks. Do not set deterministic=true.",
              },
              {
                role: "user",
                content: `Propose ${job.count} diverse questions for category ${job.category_id}. categoryIds must be ["${job.category_id}"].`,
              },
            ],
          }),
        },
      );
      if (!r.ok) throw new Error(`Model provider HTTP ${r.status}`);
      const data: any = await r.json();
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
      if (
        !Array.isArray(parsed.questions) ||
        parsed.questions.length > job.count
      )
        throw new Error("Invalid model candidate count");
      for (const q of parsed.questions)
        await ingest(
          candidateSchema.parse({
            ...q,
            deterministic: false,
            provenance:
              "Model proposal; evidence unverified; manual review required.",
          }),
        );
    }
    await pool.query(
      "UPDATE generation_jobs SET status='finished',error=null WHERE id=$1 AND lease_token=$2 AND status='running'",
      [job.id,job.leaseToken],
    );
  } catch (error) {
    await pool.query(
      "UPDATE generation_jobs SET status=CASE WHEN attempts<max_attempts THEN 'queued' ELSE 'failed' END,error=$2 WHERE id=$1 AND lease_token=$3 AND status='running'",
      [job.id, error instanceof Error ? error.message : "Unknown error",job.leaseToken],
    );
    console.error("Generation job failed", job.id);
  }
  return true;
}
if (process.argv[1]?.endsWith("worker.ts")) {
  console.log("Editorial worker running. Candidates require human approval.");
  let stop = false;
  process.on("SIGTERM", () => (stop = true));
  process.on("SIGINT", () => (stop = true));
  while (!stop) {
    await runJob();
    await new Promise((r) => setTimeout(r, 5000));
  }
  await pool.end();
}
