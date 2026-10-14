import "dotenv/config";
export function integerSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`Invalid ${name}; expected ${minimum}–${maximum}`);
  return value;
}
export function validateRuntime() {
  if (!process.env.APP_ORIGIN && process.env.RENDER_EXTERNAL_URL)
    process.env.APP_ORIGIN = new URL(process.env.RENDER_EXTERNAL_URL).origin;
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.DATABASE_URL) throw new Error("Production requires DATABASE_URL");
  const origin = new URL(process.env.APP_ORIGIN || "http://invalid");
  if (origin.protocol !== "https:" || origin.origin !== process.env.APP_ORIGIN)
    throw new Error("Production APP_ORIGIN must be an HTTPS origin without a path");
  if (process.env.COOKIE_SECURE !== "true") throw new Error("Production requires secure cookies");
  if (process.env.REQUIRE_SHARED_LIMITS === "true" && !process.env.REDIS_URL)
    throw new Error("Shared rate limits require REDIS_URL");
  if(process.env.MEDIA_BUCKET) {
    if(!process.env.MEDIA_ACCESS_KEY_ID || !process.env.MEDIA_SECRET_ACCESS_KEY) throw new Error("Object storage requires its secure credential bindings.");
    if(process.env.MEDIA_ENDPOINT && new URL(process.env.MEDIA_ENDPOINT).protocol!=="https:") throw new Error("Production media storage requires HTTPS.");
  }
}
