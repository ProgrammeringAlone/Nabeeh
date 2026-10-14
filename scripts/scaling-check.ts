import {spawn} from "node:child_process";
import {mkdir,open} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import assert from "node:assert/strict";
import pg from "pg";
const database=process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh";
const redisUrl=process.env.REDIS_URL || "redis://127.0.0.1:56379";
if(!["localhost","127.0.0.1"].includes(new URL(database).hostname) || !["localhost","127.0.0.1"].includes(new URL(redisUrl).hostname)) throw new Error("Scaling check is local-only; do not point it at live services.");
await mkdir(".local",{recursive:true});const log=await open(".local/scaling-server.log","w");
const ports=[3407,3408];
const servers=ports.map(port=>spawn(process.execPath,["--import","tsx","server/index.ts"],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:database,REDIS_URL:redisUrl,COOKIE_SECURE:"true",APP_ORIGIN:"https://scaling-check.nabeeh.invalid",PORT:String(port),DB_POOL_MAX:"2",REQUIRE_SHARED_LIMITS:"true",RATE_LIMIT_PROFILE:"3",RUN_WORKER:"false"},stdio:["ignore",log.fd,log.fd]}));
let profileId:string|undefined;
try {
  for(const port of ports) {
    let ready=false;
    for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await delay(200);}
    assert.ok(ready,"App instance must become healthy with real Redis");
  }
  const first=await fetch(`http://127.0.0.1:${ports[0]}/api/me`);assert.equal(first.status,200);
  const cookie=first.headers.get("set-cookie")!.split(";")[0];profileId=(await first.json()).profileId;
  for(const port of [ports[1],ports[0]]) {const r=await fetch(`http://127.0.0.1:${port}/api/me`,{headers:{Cookie:cookie}});assert.equal(r.status,200);await r.json();}
  const blocked=await fetch(`http://127.0.0.1:${ports[1]}/api/me`,{headers:{Cookie:cookie}});assert.equal(blocked.status,429);await blocked.json();
  console.log("PASS: two independent app processes share one real Redis quota (three allowed, fourth blocked).");
} finally {
  for(const child of servers)child.kill("SIGTERM");
  await Promise.all(servers.map(child=>new Promise<void>(resolve=>{child.on("exit",()=>resolve());setTimeout(()=>{if(child.exitCode===null)child.kill("SIGKILL");resolve();},10000).unref();})));
  await log.close();
  if(profileId){const db=new pg.Client({connectionString:database});await db.connect();await db.query("DELETE FROM sessions WHERE profile_id=$1",[profileId]);await db.query("DELETE FROM profiles WHERE id=$1",[profileId]);await db.end();}
}
