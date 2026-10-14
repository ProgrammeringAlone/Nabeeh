import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { raw, type Request, type Response } from "express";
import { z } from "zod";
import { pool, AppError } from "./db.ts";
export const mediaSchema = z.object({
  assetId: z.uuid(), alt: z.string().min(5).max(500),
  transcript: z.string().max(2000).optional(),
}).strict();
const objectStore = process.env.MEDIA_BUCKET ? new S3Client({
  region: process.env.MEDIA_REGION || "auto",
  ...(process.env.MEDIA_ENDPOINT ? { endpoint: process.env.MEDIA_ENDPOINT } : {}),
  forcePathStyle: process.env.MEDIA_PATH_STYLE === "true",
  credentials: { accessKeyId: process.env.MEDIA_ACCESS_KEY_ID || "", secretAccessKey: process.env.MEDIA_SECRET_ACCESS_KEY || "" },
}) : null;
export const mediaBody = raw({ type: ["image/png","image/jpeg","image/webp","audio/wav","audio/ogg","video/webm","video/mp4"], limit: "10mb" });
function validSignature(bytes: Buffer, mime: string) {
  if (mime === "image/png") return bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"));
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  if (mime === "audio/wav") return bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WAVE";
  if (mime === "audio/ogg") return bytes.toString("ascii",0,4) === "OggS";
  if (mime === "video/mp4") return bytes.toString("ascii",4,8) === "ftyp";
  return mime === "video/webm" && bytes.subarray(0,4).equals(Buffer.from("1a45dfa3","hex"));
}
export async function uploadMedia(req: Request, res: Response) {
  if (!objectStore) throw new AppError(503, "MEDIA_STORAGE_REQUIRED", "تخزين الوسائط لم يُجهّز بعد.");
  const metadata = z.object({
    credit: z.string().min(3).max(500), license: z.string().min(3).max(500),
    source: z.string().url().max(2000).refine(s=>s.startsWith("https://")).optional(),
  }).parse({ credit: decodeURIComponent(String(req.headers["x-media-credit"] || "")), license: decodeURIComponent(String(req.headers["x-media-license"] || "")), source: req.headers["x-media-source"] ? decodeURIComponent(String(req.headers["x-media-source"])) : undefined });
  const mime = req.headers["content-type"]?.split(";")[0] || "";
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || !validSignature(bytes, mime))
    throw new AppError(400, "MEDIA_INVALID", "الملف لا يطابق نوع الوسائط المسموح.");
  const id = randomUUID(), objectKey = "media/" + id;
  await objectStore.send(new PutObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: objectKey, Body: bytes, ContentType: mime }));
  await pool.query("INSERT INTO media_assets(id,mime,storage,object_key,size_bytes,sha256,credit,license,source,created_by) VALUES($1,$2,'object',$3,$4,$5,$6,$7,$8,$9)", [id,mime,objectKey,bytes.length,createHash("sha256").update(bytes).digest("hex"),metadata.credit,metadata.license,metadata.source ?? null,req.identity.userId]);
  res.status(201).json({ id, mime, sizeBytes: bytes.length });
}
export async function serveGameMedia(req: Request, res: Response) {
  const gameId = z.uuid().parse(req.params.id), instanceId = z.uuid().parse(req.params.instanceId);
  const { rows: [asset] } = await pool.query("SELECT a.* FROM games g JOIN game_questions i ON i.game_id=g.id JOIN questions q ON q.id=i.question_id JOIN media_assets a ON a.id=q.media_id WHERE g.id=$1 AND g.host_id=$2 AND i.id=$3 AND i.status IN('open','revealed','completed')", [gameId,req.identity.profileId,instanceId]);
  if (!asset) throw new AppError(404,"MEDIA_NOT_FOUND","الوسائط غير متاحة.");
  await serveAsset(asset,req,res);
}
export async function serveEditorMedia(req: Request,res: Response) {
  const {rows:[asset]} = await pool.query("SELECT * FROM media_assets WHERE id=$1", [z.uuid().parse(req.params.assetId)]);
  if (!asset) throw new AppError(404,"MEDIA_NOT_FOUND","الوسائط غير متاحة.");
  await serveAsset(asset,req,res);
}
async function serveAsset(asset: any,req: Request,res: Response) {
  let bytes: Buffer;
  if (asset.storage === "bundle") {
    if (!/^[a-f0-9-]+\.(svg|wav|mp4|webm)$/.test(asset.object_key)) throw new Error("Invalid bundle key");
    bytes = await readFile(resolve("media/bundle", asset.object_key));
  } else {
    if (!objectStore) throw new AppError(503,"MEDIA_STORAGE_REQUIRED","الوسائط غير متاحة مؤقّتًا.");
    const object = await objectStore.send(new GetObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: asset.object_key }));
    if (!object.Body || object.ContentLength !== asset.size_bytes) throw new Error("Media integrity failure");
    bytes = Buffer.from(await object.Body.transformToByteArray());
  }
  if (bytes.length !== asset.size_bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new Error("Media integrity failure");
  res.setHeader("Content-Type", asset.mime);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = 0, end = bytes.length - 1;
    if (match) {
      start = match[1] ? Number(match[1]) : Math.max(0,bytes.length-Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]),end) : end;
    }
    if (!match || (!match[1] && !match[2]) || start > end || start >= bytes.length) {
      res.setHeader("Content-Range",`bytes */${bytes.length}`); res.sendStatus(416); return;
    }
    res.status(206).setHeader("Content-Range",`bytes ${start}-${end}/${bytes.length}`);
    bytes = bytes.subarray(start,end+1);
  }
  res.setHeader("Content-Length",bytes.length);
  res.send(bytes);
}
