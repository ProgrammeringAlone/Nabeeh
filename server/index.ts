import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import { resolve } from "node:path";
import { api } from "./api.ts";
import { pool, AppError } from "./db.ts";
import { validateRuntime, integerSetting } from "./config.ts";
import { limiter, connectLimits, closeLimits, redis } from "./limits.ts";
import { startEmbeddedWorker } from "./worker.ts";
validateRuntime();
await connectLimits();
const app = express(),
  production = process.env.NODE_ENV === "production";
if (production && process.env.COOKIE_SECURE !== "true")
  throw new Error("Production requires COOKIE_SECURE=true and HTTPS");
app.disable("x-powered-by");
// Set only for an operator-verified proxy topology. Never trust arbitrary forwarded headers.
if (process.env.TRUST_PROXY_HOPS !== undefined)
  app.set("trust proxy", integerSetting("TRUST_PROXY_HOPS", 0, 0, 5));
app.use(
  helmet({
    contentSecurityPolicy: production
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'"],
            connectSrc: ["'self'"],
            mediaSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
  }),
);
app.use("/api", limiter("ip"));
app.use("/api/auth", limiter("auth"));
app.use(express.json({ limit: "512kb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  if (
    req.headers["x-nabeeh-request"] !== "1" ||
    (req.headers.origin && req.headers.origin !== origin)
  )
    return next(new AppError(403, "CSRF", "الطلب غير مسموح."));
  next();
});
app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  if (redis) await redis.ping();
  res.json({ status: "ok" });
});
app.use("/api", api);
app.use("/api", (_req, res) =>
  res.status(404).json({ code: "NOT_FOUND", message: "المسار غير موجود." }),
);
if (production) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (
      error.type === "entity.parse.failed" ||
      error.type === "entity.too.large"
    )
      return res
        .status(error.type === "entity.too.large" ? 413 : 400)
        .json({
          code: "INVALID_JSON",
          message: "صيغة الطلب غير صالحة أو حجمه أكبر من المسموح.",
        });
    if (error.code === "23503")
      return res
        .status(400)
        .json({
          code: "INVALID_REFERENCE",
          message: "الفئة أو السؤال المرتبط غير موجود.",
        });
    if (error instanceof z.ZodError)
      return res.status(400).json({
        code: "INVALID_INPUT",
        message: "راجع البيانات المدخلة.",
        issues: error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    if (error instanceof AppError)
      return res
        .status(error.status)
        .json({ code: error.code, message: error.message });
    if (error.code === "23505")
      return res
        .status(409)
        .json({ code: "CONFLICT", message: "هذا السجل موجود بالفعل." });
    console.error(
      JSON.stringify({
        level: "error",
        code: error.code || "INTERNAL",
        message: error.message,
      }),
    );
    res
      .status(500)
      .json({ code: "INTERNAL", message: "تعذّر إكمال الطلب. حاول مرة أخرى." });
  },
);
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Nabeeh running on port", process.env.PORT || 3000),
);
const stopWorker=process.env.RUN_WORKER === "true" ? startEmbeddedWorker() : async()=>{};
async function stop() {
  const forced = setTimeout(() => process.exit(1), 10000);
  forced.unref();
  server.close(async () => {
    await stopWorker();
    await Promise.all([pool.end(), closeLimits()]);
    clearTimeout(forced);
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
