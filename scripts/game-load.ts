import {spawn} from "node:child_process";
import {mkdir,open,writeFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {performance} from "node:perf_hooks";
import assert from "node:assert/strict";
import pg from "pg";
const base=process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54329/nabeeh",url=new URL(base);
if(!["127.0.0.1","localhost"].includes(url.hostname)) throw new Error("Game load check is local-only and uses a separate _load database.");
const admin=new pg.Client({connectionString:base});await admin.connect();
if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='nabeeh_load'")).rowCount)await admin.query('CREATE DATABASE "nabeeh_load"');await admin.end();
url.pathname="/nabeeh_load";const port=3410,origin=`http://127.0.0.1:${port}`;
const env={...process.env,DATABASE_URL:url.href,NODE_ENV:"development",PORT:String(port),APP_ORIGIN:origin,COOKIE_SECURE:"false",REDIS_URL:"",RUN_WORKER:"false",RATE_LIMIT_IP:"100000",DB_POOL_MAX:"10"};
const db=new pg.Client({connectionString:url.href});await db.connect();await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
await mkdir(".local",{recursive:true});const log=await open(".local/game-load-server.log","w");
async function command(file:string) {await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,["--import","tsx",file],{env,stdio:["ignore",log.fd,log.fd]});child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error("Load database preparation failed")));});}
await command("scripts/migrate.ts");await command("scripts/seed.ts");
const server=spawn(process.execPath,["--import","tsx","server/index.ts"],{env,stdio:["ignore",log.fd,log.fd]});
const timings:number[]=[],count=Number(process.env.LOAD_PLAYERS || 30),concurrency=Number(process.env.LOAD_CONCURRENCY || 10);
assert.ok(Number.isInteger(count)&&count>=1&&count<=100);assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=30);
try {
  let ready=false;for(let i=0;i<50;i++){try{if((await fetch(origin+"/health")).ok){ready=true;break;}}catch{}await delay(200);}assert.ok(ready);
  async function request(path:string,cookie:string,body?:unknown) {
    const start=performance.now(),r=await fetch(origin+path,{method:body===undefined?"GET":"POST",headers:{Cookie:cookie,"X-Nabeeh-Request":"1","Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await r.json();timings.push(performance.now()-start);if(!r.ok)throw new Error(`Load operation ${path} failed with ${r.status}`);return data;
  }
  let next=0;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next++<count) {
      const me=await fetch(origin+"/api/me");assert.equal(me.status,200);const cookie=me.headers.get("set-cookie")!.split(";")[0];await me.json();
      const seen=new Set<string>();
      for(const mode of ["classic","rapid"]) {
        const {id}=await request("/api/games",cookie,{categoryIds:["logic"],teamNames:["ألف","باء"],timer:180,mode});
        let game=await request("/api/games/"+id,cookie);
        for(const tile of game.tiles) {
          const opened=await request(`/api/games/${id}/open`,cookie,{instanceId:tile.id});assert.equal(opened.current.answer,null);assert.equal(seen.has(opened.current.question_id),false);seen.add(opened.current.question_id);
          await request(`/api/games/${id}/reveal`,cookie,{});
          await Promise.all([request(`/api/games/${id}/score`,cookie,{instanceId:tile.id,outcome:"correct"}),request(`/api/games/${id}/score`,cookie,{instanceId:tile.id,outcome:"correct"})]);
        }
        game=await request("/api/games/"+id,cookie);assert.equal(game.status,"finished");assert.equal(game.teams.reduce((sum:number,t:any)=>sum+t.score,0),1200);
      }
      assert.equal(seen.size,6);
    }
  }));
  assert.equal(Number((await db.query("SELECT count(*) FROM score_events")).rows[0].count),count*6);
  assert.equal(Number((await db.query("SELECT count(*) FROM exposures")).rows[0].count),count*6);
  timings.sort((a,b)=>a-b);
  const report={players:count,concurrency,completedGames:count*2,requests:timings.length,failures:0,p50Ms:Math.round(timings[Math.floor(timings.length*.5)]),p95Ms:Math.round(timings[Math.floor(timings.length*.95)]),scope:"Local isolated database; not a hosted capacity guarantee"};
  await writeFile(".local/game-load-report.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {server.kill("SIGTERM");await log.close();await db.end();}
