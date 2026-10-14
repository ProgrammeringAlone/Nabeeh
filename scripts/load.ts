import { performance } from "node:perf_hooks";
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const timings: number[] = [];
let failures = 0;
// Readiness smoke load, not a capacity benchmark. Reuse one profile rather than creating 100 guests.
const me = await fetch(origin + "/api/me");
if (!me.ok) throw new Error("Identity bootstrap failed");
const cookie = me.headers.get("set-cookie")?.split(";")[0] || "";
for (let batch = 0; batch < 5; batch++)
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      const t = performance.now();
      const r = await fetch(origin + "/api/categories", {
        headers: { Cookie: cookie },
      });
      const rows: any = await r.json();
      if (!r.ok || !Array.isArray(rows)) failures++;
      timings.push(performance.now() - t);
    }),
  );
timings.sort((a, b) => a - b);
const report = {
  requests: timings.length,
  concurrency: 10,
  failures,
  p50Ms: Math.round(timings[Math.floor(timings.length * 0.5)]),
  p95Ms: Math.round(timings[Math.floor(timings.length * 0.95)]),
};
console.log(JSON.stringify(report, null, 2));
if (failures) process.exitCode = 1;
