import {spawn} from "node:child_process";
import {createReadStream,createWriteStream} from "node:fs";
import {mkdir} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
const url=new URL(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh");
if(!["127.0.0.1","localhost"].includes(url.hostname)) throw new Error("Restore check is local-only. Use a separate approved branch for a managed-database drill.");
await mkdir(".local",{recursive:true});
const target="nabeeh_restore_"+randomUUID().replaceAll("-","").slice(0,8),backup=".local/restore-check.dump";
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port || "5432",PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1),PGSSLMODE:"disable"};
const source=new pg.Client({connectionString:url.href});await source.connect();
await source.query(`CREATE DATABASE "${target}"`);
async function dockerClient(args:string[],write:boolean,database:string) {
  const child=spawn("docker",["--config",".local/docker","run","--rm","--interactive","--network","host",...Object.keys(env).filter(n=>n.startsWith("PG")).flatMap(n=>["--env",n]),"postgres:18-alpine",...args],{env:{...env,PGDATABASE:database},stdio:[write?"ignore":"pipe",write?"pipe":"ignore","inherit"]});
  const exit=new Promise<void>((resolve,reject)=>{child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error("PostgreSQL dump/restore command failed")));});
  await Promise.all([exit,write ? pipeline(child.stdout!,createWriteStream(backup,{mode:0o600})) : pipeline(createReadStream(backup),child.stdin!)]);
}
async function counts(client:pg.Client) {
  const result:Record<string,string>={};
  for(const table of ["questions","profiles","sessions","games","exposures","score_events","candidates","media_assets"]) result[table]=(await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count;
  result.exposureDigest=(await client.query("SELECT md5(COALESCE(string_agg(profile_id::text||question_id::text,',' ORDER BY profile_id,question_id),'')) AS digest FROM exposures")).rows[0].digest;
  return result;
}
try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const before=await counts(source);
  const snapshot=(await source.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
  await dockerClient(["pg_dump","--format=custom","--no-owner","--snapshot",snapshot],true,env.PGDATABASE);
  await source.query("COMMIT");
  await dockerClient(["pg_restore","--no-owner","--exit-on-error","--dbname",target],false,target);
  const restoredUrl=new URL(url);restoredUrl.pathname="/"+target;
  const restored=new pg.Client({connectionString:restoredUrl.href});await restored.connect();
  assert.deepEqual(await counts(restored),before);await restored.end();
  console.log("PASS: a real PostgreSQL backup restored into an isolated database with matching records and exposure ledger.");
} finally {await source.query("ROLLBACK");await source.query(`DROP DATABASE "${target}" WITH (FORCE)`);await source.end();}
