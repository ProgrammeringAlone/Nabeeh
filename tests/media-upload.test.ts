import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";
import pg from "pg";

const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
const isolated = new URL(base);
if (!process.env.TEST_DATABASE_URL && !["localhost","127.0.0.1"].includes(isolated.hostname)) throw new Error("External media tests require an explicit isolated TEST_DATABASE_URL ending in _test.");
if (process.env.TEST_DATABASE_URL && !isolated.pathname.endsWith("_test")) throw new Error("Media integration database name must end in _test.");
const databaseName = "media_upload_" + randomUUID().replaceAll("-", "") + "_test";
isolated.pathname = "/" + databaseName;
process.env.DATABASE_URL = isolated.href;
process.env.MEDIA_DATABASE_BUDGET_BYTES = String(1024 * 1024);
delete process.env.MEDIA_BUCKET;
delete process.env.MEDIA_ACCESS_KEY_ID;
delete process.env.MEDIA_SECRET_ACCESS_KEY;
const { pool, AppError } = await import("../server/db.ts");
const { identity, requireEditor, tokenHash } = await import("../server/auth.ts");
const { mediaBody, uploadMedia, serveEditorMedia, serveGameMedia, listEditorMedia } = await import("../server/media.ts");
let server: Server | undefined;
let origin = "";
let editorCookie = "", guestCookie = "", editorProfile = "";
let createdDatabase = false;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const metadata = { "x-media-credit": encodeURIComponent("فريق الاختبار"), "x-media-license": encodeURIComponent("ملف أصلي للاختبار"), "x-media-source": "https%3A%2F%2Fexample.com%2Foriginal" };

async function createSession(role: "editor"|"guest") {
  const profileId = randomUUID(), token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO profiles(id,kind) VALUES($1,$2)",[profileId,role === "guest" ? "guest" : "account"]);
  if (role === "editor") await pool.query("INSERT INTO users(id,profile_id,username,password_hash,role) VALUES($1,$2,$3,'unused-fixture-hash','editor')",[randomUUID(),profileId,"media_"+profileId.slice(0,8)]);
  await pool.query("INSERT INTO sessions(token_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[tokenHash(token),profileId]);
  return {profileId,cookie:"nabeeh_session="+token};
}
function post(bytes: Buffer, mime = "image/png", headers: Record<string,string> = {}, cookie = editorCookie) {
  return fetch(origin+"/media",{method:"POST",headers:{cookie,"content-type":mime,...metadata,...headers},body:new Uint8Array(bytes)});
}
function mp3(withTag = false) {
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz: complete 417-byte frame.
  const frame = Buffer.alloc(417);frame.set([255,251,144,100]);
  return withTag ? Buffer.concat([Buffer.from([73,68,51,4,0,0,0,0,0,0]),frame]) : frame;
}

before(async()=>{
  const admin = new pg.Client({connectionString:base});
  await admin.connect();
  try {await admin.query('CREATE DATABASE "'+databaseName+'"');createdDatabase=true;} finally {await admin.end();}
  execFileSync("node",["--import","tsx","scripts/migrate.ts"],{env:process.env});
  ({cookie:editorCookie,profileId:editorProfile} = await createSession("editor"));
  ({cookie:guestCookie} = await createSession("guest"));
  const app = express();
  app.use(identity);
  app.post("/media",requireEditor,mediaBody,uploadMedia);
  app.get("/media",requireEditor,async(req,res)=>res.json(await listEditorMedia(req.query.format as "image"|"audio"|"video"|undefined,req.query.cursor as string|undefined,req.query.limit ? Number(req.query.limit) : undefined)));
  app.get("/media/:assetId",requireEditor,serveEditorMedia);
  app.get("/games/:id/media/:instanceId",serveGameMedia);
  app.use((error:any,_req:Request,res:Response,_next:NextFunction)=>res.status(error instanceof AppError ? error.status : error.type === "entity.too.large" ? 413 : error.code === "23503" ? 400 : 500).json({code:error.code || error.type || "INTERNAL"}));
  server = app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server!.once("listening",resolve));
  const address = server.address();assert.ok(address && typeof address !== "string");
  origin = "http://127.0.0.1:"+address.port;
});
beforeEach(async()=>{
  await pool.query("UPDATE games SET current_instance=null; DELETE FROM games; DELETE FROM questions; DELETE FROM media_assets");
});
after(async()=>{
  if (server) {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server!.close(error=>error ? reject(error) : resolve()));}
  await pool.end();
  if (createdDatabase) {
    const admin = new pg.Client({connectionString:base});await admin.connect();
    try {await admin.query('DROP DATABASE "'+databaseName+'"');} finally {await admin.end();}
  }
});

test("Private database uploads preserve bytes, Arabic rights metadata and paginated media reuse",async()=>{
  const first=await post(png);assert.equal(first.status,201);const firstAsset=await first.json();
  const second=await post(png);assert.equal(second.status,201);const secondAsset=await second.json();
  const audio=await post(mp3(),"audio/mpeg");assert.equal(audio.status,201);
  const stored=(await pool.query("SELECT a.*,b.bytes FROM media_assets a JOIN media_blobs b ON b.asset_id=a.id WHERE a.id=$1",[firstAsset.id])).rows[0];
  assert.equal(stored.storage,"database");assert.equal(stored.credit,"فريق الاختبار");assert.equal(stored.source,"https://example.com/original");assert.deepEqual(stored.bytes,png);
  assert.equal(stored.sha256,createHash("sha256").update(png).digest("hex"));
  const page=await listEditorMedia("image",undefined,1);assert.equal(page.maxBytes,10485760);assert.equal(page.databaseBudgetBytes,1048576);assert.equal(page.assets.length,1);assert.equal(page.assets[0].id,secondAsset.id);assert.ok(page.nextCursor);
  assert.equal("bytes" in page.assets[0],false);assert.equal("object_key" in page.assets[0],false);
  const next=await listEditorMedia("image",page.nextCursor,1);assert.equal(next.assets[0].id,firstAsset.id);assert.equal(next.nextCursor,null);
  assert.equal((await listEditorMedia("audio")).assets.length,1);assert.equal((await listEditorMedia("video")).assets.length,0);
});

test("Uploads without optional metadata preserve uploader identity and do not invent rights declarations",async()=>{
  for (const headers of [undefined,{"x-media-credit":"%20%20","x-media-license":"","x-media-source":"%20"}]) {
    const response=await fetch(origin+"/media",{method:"POST",headers:{cookie:editorCookie,"content-type":"image/png",...headers},body:new Uint8Array(png)});
    assert.equal(response.status,201);const {id}=await response.json();
    const stored=(await pool.query("SELECT a.credit,a.license,a.source,a.created_by,u.profile_id FROM media_assets a JOIN users u ON u.id=a.created_by WHERE a.id=$1",[id])).rows[0];
    assert.equal(stored.credit,null);assert.equal(stored.license,null);assert.equal(stored.source,null);
    assert.ok(stored.created_by);assert.equal(stored.profile_id,editorProfile);
  }
  const page=await listEditorMedia("image");assert.equal(page.assets.length,2);
  assert.ok(page.assets.every(asset=>asset.credit===null && asset.license===null && asset.source===null));
});

test("Uploads reject malformed optional metadata, MIME disguises and oversized files before storing data",async()=>{
  const invalidMetadata:Record<string,string>[]=[{"x-media-credit":"%E0%A4%A"},{"x-media-source":"javascript%3Aalert(1)"},{"x-media-source":"http%3A%2F%2Fexample.com"},{"x-media-source":"https%3A%2F%2Fuser%3Apass%40example.com"},{"x-media-credit":"ab"},{"x-media-license":"ab"}];
  for (const headers of invalidMetadata) {
    const response=await post(png,"image/png",headers);assert.equal(response.status,400);assert.equal((await response.json()).code,"MEDIA_METADATA_INVALID");
  }
  assert.equal((await post(png,"audio/mpeg")).status,400);
  assert.equal((await post(Buffer.from("ID3".padEnd(100,"0")),"audio/mpeg")).status,400);
  const oversized=Buffer.alloc(10485761);png.copy(oversized);
  assert.equal((await post(oversized)).status,413);
  // Editor authorization runs before parsing the large body.
  assert.equal((await post(oversized,"image/png",{},guestCookie)).status,403);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM media_assets")).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM media_blobs")).rows[0].n,0);
});

test("MP3 uploads accept ID3 and untagged complete frames, and reject invalid MPEG headers",async()=>{
  assert.equal((await post(mp3(),"audio/mpeg")).status,201);
  assert.equal((await post(mp3(true),"audio/mpeg")).status,201);
  const reserved=mp3();reserved[1]=235;
  assert.equal((await post(reserved,"audio/mpeg")).status,400);
  assert.equal((await post(mp3().subarray(0,40),"audio/mpeg")).status,400);
  const invalidTag=mp3(true);invalidTag[6]=255;
  assert.equal((await post(invalidTag,"audio/mpeg")).status,400);
});

test("Concurrent uploads cannot exceed the database media budget or leave partial metadata",async()=>{
  const large=Buffer.alloc(600000);png.copy(large);
  const responses=await Promise.all([post(large),post(large)]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,413]);
  const rejected=responses.find(response=>response.status===413)!;assert.equal((await rejected.json()).code,"MEDIA_STORAGE_FULL");
  const stats=(await pool.query("SELECT count(*)::int AS n,sum(size_bytes)::int AS bytes FROM media_assets")).rows[0];
  assert.deepEqual(stats,{n:1,bytes:600000});assert.equal((await pool.query("SELECT count(*)::int AS n FROM media_blobs")).rows[0].n,1);
  assert.equal((await listEditorMedia()).databaseUsedBytes,600000);
  await pool.query("DELETE FROM media_assets");assert.equal((await pool.query("SELECT count(*)::int AS n FROM media_blobs")).rows[0].n,0);
});

test("Private database media supports ranges, ownership checks and integrity validation",async()=>{
  const uploaded=await post(png);assert.equal(uploaded.status,201);const {id}=await uploaded.json();
  const full=await fetch(origin+"/media/"+id,{headers:{cookie:editorCookie}});assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),png);
  const partial=await fetch(origin+"/media/"+id,{headers:{cookie:editorCookie,range:"bytes=2-8"}});assert.equal(partial.status,206);assert.equal(partial.headers.get("content-range"),`bytes 2-8/${png.length}`);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),png.subarray(2,9));
  const suffix=await fetch(origin+"/media/"+id,{headers:{cookie:editorCookie,range:"bytes=-4"}});assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),png.subarray(-4));
  for(const range of ["bytes=999999-","bytes=-0","bytes=9007199254740993-","bytes=0-1,3-4"]) assert.equal((await fetch(origin+"/media/"+id,{headers:{cookie:editorCookie,range}})).status,416);
  assert.equal((await fetch(origin+"/media/"+id,{headers:{cookie:guestCookie}})).status,403);
  const gameId=randomUUID(),questionId=randomUUID(),instanceId=randomUUID();
  await pool.query("INSERT INTO questions(id,fact_key,subject,predicate,fact,text,normalized_hash,answer,explanation,hint,difficulty,format,status,media_id,provenance) VALUES($1,$2,'fixture','fixture','fixture','سؤال ملف خاص',$2,'اختبار','شرح للاختبار','تلميح للاختبار','easy','image','approved',$3,'Original isolated test fixture')",[questionId,questionId,id]);
  await pool.query("INSERT INTO games(id,host_id,mode,timer,stealing,negative_scores,lifelines) VALUES($1,$2,'classic',60,true,false,'{}')",[gameId,editorProfile]);
  await pool.query("INSERT INTO game_questions(id,game_id,question_id,category_id,value,position,status) VALUES($1,$2,$3,'logic',200,0,'available')",[instanceId,gameId,questionId]);
  const path=origin+"/games/"+gameId+"/media/"+instanceId;
  assert.equal((await fetch(path,{headers:{cookie:editorCookie}})).status,404);
  await pool.query("UPDATE game_questions SET status='open' WHERE id=$1",[instanceId]);
  assert.equal((await fetch(path,{headers:{cookie:editorCookie}})).status,200);
  assert.equal((await fetch(path,{headers:{cookie:guestCookie}})).status,404);
  await pool.query("UPDATE media_blobs SET bytes=$2 WHERE asset_id=$1",[id,Buffer.alloc(png.length)]);
  assert.equal((await fetch(path,{headers:{cookie:editorCookie}})).status,500);
});
