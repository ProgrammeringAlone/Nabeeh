import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { raw, type Request, type Response } from "express";
import { z } from "zod";
import { pool, transaction, AppError } from "./db.ts";
import { integerSetting } from "./config.ts";
export const mediaSchema = z
  .object({
    assetId: z.uuid(),
    alt: z.string().min(5).max(500),
    transcript: z.string().max(2000).optional(),
  })
  .strict();
// Answer images have their own reveal boundary; they never share the stimulus route.
export const answerMediaSchema = mediaSchema.pick({ assetId: true, alt: true });
const objectStore =
  process.env.MEDIA_BUCKET &&
  process.env.MEDIA_ACCESS_KEY_ID &&
  process.env.MEDIA_SECRET_ACCESS_KEY
    ? new S3Client({
        region: process.env.MEDIA_REGION || "auto",
        ...(process.env.MEDIA_ENDPOINT
          ? { endpoint: process.env.MEDIA_ENDPOINT }
          : {}),
        forcePathStyle: process.env.MEDIA_PATH_STYLE === "true",
        credentials: {
          accessKeyId: process.env.MEDIA_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.MEDIA_SECRET_ACCESS_KEY || "",
        },
      })
    : null;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const databaseBudgetBytes = integerSetting(
  "MEDIA_DATABASE_BUDGET_BYTES",
  100 * 1024 * 1024,
  0,
  1024 * 1024 * 1024,
);
export const mediaBody = raw({
  type: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "audio/wav",
    "audio/ogg",
    "audio/mpeg",
    "video/webm",
    "video/mp4",
  ],
  limit: MEDIA_MAX_BYTES,
});
function validMp3(bytes: Buffer) {
  let offset = 0;
  if (bytes.toString("ascii", 0, 3) === "ID3") {
    if (
      bytes.length < 10 ||
      ![2, 3, 4].includes(bytes[3]) ||
      bytes[4] === 255 ||
      bytes.subarray(6, 10).some((b) => b > 127)
    )
      return false;
    const tagSize =
      bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
    offset = 10 + tagSize + (bytes[3] === 4 && bytes[5] & 16 ? 10 : 0);
  }
  if (
    bytes.length < offset + 4 ||
    bytes[offset] !== 255 ||
    (bytes[offset + 1] & 224) !== 224
  )
    return false;
  const version = (bytes[offset + 1] >> 3) & 3,
    layer = (bytes[offset + 1] >> 1) & 3;
  const bitrateIndex = bytes[offset + 2] >> 4,
    sampleIndex = (bytes[offset + 2] >> 2) & 3;
  if (
    version === 1 ||
    layer !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleIndex === 3
  )
    return false;
  const bitrate = (
    version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  )[bitrateIndex];
  const sampleRate =
    [44100, 48000, 32000][sampleIndex] /
    (version === 3 ? 1 : version === 2 ? 2 : 4);
  const frameBytes =
    Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) +
    ((bytes[offset + 2] >> 1) & 1);
  return bytes.length >= offset + frameBytes;
}
function validSignature(bytes: Buffer, mime: string) {
  if (mime === "image/png")
    return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  if (mime === "audio/wav")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WAVE"
    );
  if (mime === "audio/ogg") return bytes.toString("ascii", 0, 4) === "OggS";
  if (mime === "audio/mpeg") return validMp3(bytes);
  if (mime === "video/mp4") return bytes.toString("ascii", 4, 8) === "ftyp";
  return (
    mime === "video/webm" &&
    bytes.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"))
  );
}
function metadataHeader(req: Request, name: string) {
  const value = req.headers[name];
  if (value === undefined) return "";
  if (typeof value !== "string")
    throw new AppError(
      400,
      "MEDIA_METADATA_INVALID",
      "راجع المعلومات الإضافية للملف.",
    );
  try {
    return decodeURIComponent(value).trim();
  } catch {
    throw new AppError(
      400,
      "MEDIA_METADATA_INVALID",
      "تعذّر قراءة المعلومات الإضافية للملف.",
    );
  }
}
export async function uploadMedia(req: Request, res: Response) {
  const checked = z
    .object({
      credit: z.string().min(3).max(500).optional(),
      license: z.string().min(3).max(500).optional(),
      source: z
        .string()
        .url()
        .max(2000)
        .refine((s) => {
          const url = new URL(s);
          return url.protocol === "https:" && !url.username && !url.password;
        })
        .optional(),
    })
    .safeParse({
      credit: metadataHeader(req, "x-media-credit") || undefined,
      license: metadataHeader(req, "x-media-license") || undefined,
      source: metadataHeader(req, "x-media-source") || undefined,
    });
  if (!checked.success)
    throw new AppError(
      400,
      "MEDIA_METADATA_INVALID",
      "راجع المعلومات الإضافية للملف. رابط المصدر، إن أُرفق، يجب أن يبدأ بـ https.",
    );
  const metadata = checked.data;
  const mime =
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() || "";
  const bytes = req.body;
  if (Buffer.isBuffer(bytes) && bytes.length > MEDIA_MAX_BYTES)
    throw new AppError(
      413,
      "MEDIA_TOO_LARGE",
      "حجم الملف أكبر من الحد المسموح: 10 ميغابايت.",
    );
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 12 ||
    !validSignature(bytes, mime)
  )
    throw new AppError(
      400,
      "MEDIA_INVALID",
      "الملف لا يطابق نوع الوسائط المسموح.",
    );
  const id = randomUUID(),
    objectKey = "media/" + id;
  const values = [
    id,
    mime,
    objectKey,
    bytes.length,
    createHash("sha256").update(bytes).digest("hex"),
    metadata.credit ?? null,
    metadata.license ?? null,
    metadata.source ?? null,
    req.identity.userId,
  ];
  if (objectStore) {
    await objectStore.send(
      new PutObjectCommand({
        Bucket: process.env.MEDIA_BUCKET,
        Key: objectKey,
        Body: bytes,
        ContentType: mime,
      }),
    );
    await pool.query(
      "INSERT INTO media_assets(id,mime,storage,object_key,size_bytes,sha256,credit,license,source,created_by) VALUES($1,$2,'object',$3,$4,$5,$6,$7,$8,$9)",
      values,
    );
  } else {
    await transaction(async (db) => {
      // Serialize the budget decision across app processes, including concurrent uploads.
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('nabeeh:media:database-budget'))",
      );
      const {
        rows: [usage],
      } = await db.query(
        "SELECT coalesce(sum(size_bytes),0)::bigint AS used FROM media_assets WHERE storage='database'",
      );
      if (Number(usage.used) + bytes.length > databaseBudgetBytes)
        throw new AppError(
          413,
          "MEDIA_STORAGE_FULL",
          "مساحة رفع الملفات ممتلئة. أبلغ مدير الموقع لزيادة المساحة أو ربط تخزين خارجي.",
        );
      await db.query(
        "INSERT INTO media_assets(id,mime,storage,object_key,size_bytes,sha256,credit,license,source,created_by) VALUES($1,$2,'database',$3,$4,$5,$6,$7,$8,$9)",
        values,
      );
      await db.query("INSERT INTO media_blobs(asset_id,bytes) VALUES($1,$2)", [
        id,
        bytes,
      ]);
    });
  }
  res.status(201).json({ id, mime, sizeBytes: bytes.length });
}
export async function listEditorMedia(
  format?: "image" | "audio" | "video",
  cursor?: string,
  limit = 50,
) {
  const params = z
    .object({
      format: z.enum(["image", "audio", "video"]).optional(),
      cursor: z.uuid().optional(),
      limit: z.number().int().min(1).max(100),
    })
    .parse({ format, cursor, limit });
  let page: { created_at: Date; id: string } | undefined;
  if (params.cursor) {
    page = (
      await pool.query("SELECT created_at,id FROM media_assets WHERE id=$1", [
        params.cursor,
      ])
    ).rows[0];
    if (!page)
      throw new AppError(
        400,
        "MEDIA_CURSOR_INVALID",
        "حدّث مكتبة الملفات ثم حاول مرة أخرى.",
      );
  }
  const { rows } = await pool.query(
    `SELECT id,mime,credit,license,source,size_bytes AS "sizeBytes",created_at AS "createdAt" FROM media_assets WHERE ($1::text IS NULL OR mime LIKE $1 || '/%') AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`,
    [
      params.format ?? null,
      page?.created_at ?? null,
      page?.id ?? null,
      params.limit + 1,
    ],
  );
  const assets = rows.slice(0, params.limit);
  const {
    rows: [usage],
  } = await pool.query(
    "SELECT coalesce(sum(size_bytes),0)::bigint AS used FROM media_assets WHERE storage='database'",
  );
  return {
    assets,
    maxBytes: MEDIA_MAX_BYTES,
    nextCursor: rows.length > params.limit ? assets.at(-1)!.id : null,
    storage: objectStore ? "object" : "database",
    databaseBudgetBytes,
    databaseUsedBytes: Number(usage.used),
  };
}
export async function serveGameMedia(req: Request, res: Response) {
  const gameId = z.uuid().parse(req.params.id),
    instanceId = z.uuid().parse(req.params.instanceId);
  const {
    rows: [asset],
  } = await pool.query(
    "SELECT a.* FROM games g JOIN game_questions i ON i.game_id=g.id JOIN questions q ON q.id=i.question_id JOIN media_assets a ON a.id=q.media_id WHERE g.id=$1 AND g.host_id=$2 AND i.id=$3 AND i.status IN('open','revealed','completed')",
    [gameId, req.identity.profileId, instanceId],
  );
  if (!asset) throw new AppError(404, "MEDIA_NOT_FOUND", "الوسائط غير متاحة.");
  await serveAsset(asset, req, res);
}
export async function serveGameAnswerMedia(req: Request, res: Response) {
  const gameId = z.uuid().parse(req.params.id),
    instanceId = z.uuid().parse(req.params.instanceId);
  const {
    rows: [asset],
  } = await pool.query(
    "SELECT a.* FROM games g JOIN game_questions i ON i.game_id=g.id JOIN questions q ON q.id=i.question_id JOIN media_assets a ON a.id=q.answer_media_id WHERE g.id=$1 AND g.host_id=$2 AND i.id=$3 AND i.status IN('revealed','completed') AND a.mime LIKE 'image/%'",
    [gameId, req.identity.profileId, instanceId],
  );
  if (!asset) throw new AppError(404, "MEDIA_NOT_FOUND", "الوسائط غير متاحة.");
  await serveAsset(asset, req, res);
}
export async function serveEditorMedia(req: Request, res: Response) {
  const {
    rows: [asset],
  } = await pool.query("SELECT * FROM media_assets WHERE id=$1", [
    z.uuid().parse(req.params.assetId),
  ]);
  if (!asset) throw new AppError(404, "MEDIA_NOT_FOUND", "الوسائط غير متاحة.");
  await serveAsset(asset, req, res);
}
async function serveAsset(asset: any, req: Request, res: Response) {
  let bytes: Buffer;
  if (asset.storage === "bundle") {
    if (!/^[a-f0-9-]+\.(svg|wav|mp4|webm)$/.test(asset.object_key))
      throw new Error("Invalid bundle key");
    bytes = await readFile(resolve("media/bundle", asset.object_key));
  } else if (asset.storage === "database") {
    const {
      rows: [blob],
    } = await pool.query("SELECT bytes FROM media_blobs WHERE asset_id=$1", [
      asset.id,
    ]);
    if (!blob || !Buffer.isBuffer(blob.bytes))
      throw new Error("Media integrity failure");
    bytes = blob.bytes;
  } else if (asset.storage === "object") {
    if (!objectStore)
      throw new AppError(
        503,
        "MEDIA_STORAGE_REQUIRED",
        "الوسائط غير متاحة مؤقّتًا.",
      );
    const object = await objectStore.send(
      new GetObjectCommand({
        Bucket: process.env.MEDIA_BUCKET,
        Key: asset.object_key,
      }),
    );
    if (!object.Body || object.ContentLength !== asset.size_bytes)
      throw new Error("Media integrity failure");
    bytes = Buffer.from(await object.Body.transformToByteArray());
  } else throw new Error("Invalid media storage");
  if (
    bytes.length !== asset.size_bytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw new Error("Media integrity failure");
  res.setHeader("Content-Type", asset.mime);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = 0,
      end = bytes.length - 1;
    if (match) {
      start = match[1]
        ? Number(match[1])
        : Math.max(0, bytes.length - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    }
    if (
      !match ||
      (!match[1] && !match[2]) ||
      (match[1] && !Number.isSafeInteger(Number(match[1]))) ||
      (match[2] && !Number.isSafeInteger(Number(match[2]))) ||
      start > end ||
      start >= bytes.length
    ) {
      res.setHeader("Content-Range", `bytes */${bytes.length}`);
      res.sendStatus(416);
      return;
    }
    res
      .status(206)
      .setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
    bytes = bytes.subarray(start, end + 1);
  }
  res.setHeader("Content-Length", bytes.length);
  res.send(bytes);
}
