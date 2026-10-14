import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
const base=process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
const url=new URL(base);
if (!process.env.E2E_DATABASE_URL && !["127.0.0.1","localhost"].includes(url.hostname)) throw new Error("External browser tests require an explicit isolated E2E_DATABASE_URL ending in _e2e.");
if (process.env.E2E_DATABASE_URL && !url.pathname.endsWith("_e2e")) throw new Error("Browser-test database name must end in _e2e.");
if (!process.env.E2E_DATABASE_URL) {
  const admin=new pg.Client({connectionString:base});await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='nabeeh_e2e'")).rowCount) await admin.query('CREATE DATABASE "nabeeh_e2e"');
  await admin.end();url.pathname="/nabeeh_e2e";
}
const port=Number(process.env.E2E_PORT || 3005);
const connection=url.href,origin=`http://127.0.0.1:${port}`;
const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:connection,NODE_ENV:"development",PORT:String(port),APP_ORIGIN:origin,COOKIE_SECURE:"false",REDIS_URL:"",RATE_LIMIT_IP:"10000",RATE_LIMIT_AUTH:"500",RUN_WORKER:"false",E2E_BASE_URL:origin};
const db=new pg.Client({connectionString:connection});await db.connect();
await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");await db.end();
async function command(args:string[]) {
  return new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,args,{env,stdio:"inherit"});child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error("Browser test preparation or execution failed")));
  });
}
await command(["--import","tsx","scripts/migrate.ts"]);
await command(["--import","tsx","scripts/seed.ts"]);
await command(["--import","tsx","scripts/release-pack.ts"]);
await mkdir(".local",{recursive:true});const log=await open(".local/e2e-server.log","w");
const server=spawn(process.execPath,["--import","tsx","server/index.ts"],{env,stdio:["ignore",log.fd,log.fd]});
try {
  let ready=false;
  for(let i=0;i<40;i++) {
    if (server.exitCode !== null) throw new Error("Isolated browser-test server stopped; inspect .local/e2e-server.log");
    try { const r=await fetch(origin+"/health");if(r.ok){ready=true;break;} } catch {}
    await delay(250);
  }
  if(!ready) throw new Error("Browser-test server did not become ready");
  await command(["node_modules/@playwright/test/cli.js","test"]);
} finally {server.kill("SIGTERM");await log.close();}
