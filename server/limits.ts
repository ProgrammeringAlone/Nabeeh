import { createClient } from "redis";
import { RedisStore } from "rate-limit-redis";
import { rateLimit } from "express-rate-limit";
import { integerSetting } from "./config.ts";
export const redis = process.env.REDIS_URL ? createClient({
  url: process.env.REDIS_URL,
  disableOfflineQueue: true,
  socket: { connectTimeout: 5000 },
}) : null;
redis?.on("error", () => console.error(JSON.stringify({ level: "error", code: "REDIS_UNAVAILABLE" })));
let connection:Promise<unknown>|null=null;
export async function connectLimits() {
  if (!redis) return;
  if (!redis.isOpen) connection=redis.connect();
  await connection;
}
export async function closeLimits() { if (redis?.isOpen) await redis.close(); }
export function limiter(scope: "ip" | "auth" | "profile") {
  const defaults = { ip: 600, auth: 30, profile: 120 };
  return rateLimit({
    windowMs: scope === "auth" ? 15 * 60_000 : 60_000,
    limit: integerSetting(`RATE_LIMIT_${scope.toUpperCase()}`, defaults[scope], 1, 100000),
    standardHeaders: "draft-8", legacyHeaders: false,
    ...(scope === "profile" ? { keyGenerator: (req) => req.identity.profileId } : {}),
    ...(redis ? { store: new RedisStore({
      prefix: `nabeeh:${scope}:`,
      sendCommand: async (...args: string[]) => { await connectLimits();return redis.sendCommand(args); },
    }) } : {}),
    passOnStoreError: false,
    message: { code: "RATE_LIMIT", message: "طلبات كثيرة. انتظر قليلًا ثم جرّب." },
  });
}
