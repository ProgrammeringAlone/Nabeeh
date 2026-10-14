import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
const url=process.env.VECTOR_TEST_DATABASE_URL || "postgresql://postgres:local-vector-check@127.0.0.1:56380/nabeeh_check";
const parsed=new URL(url);
if(!["127.0.0.1","localhost"].includes(parsed.hostname) || !parsed.pathname.endsWith("_check")) throw new Error("Vector smoke test requires a local isolated _check database.");
process.env.DATABASE_URL=url;
const {pool,transaction}=await import("../server/db.ts");
const {insertQuestion,candidateSchema}=await import("../server/content.ts");
const {nearestSemantic}=await import("../server/semantic.ts");
await pool.query("INSERT INTO categories(id,name,description,icon,color) VALUES('vector-check','اختبار المتجهات','قاعدة مستقلة','◇','#eee') ON CONFLICT DO NOTHING");
const ids:string[]=[],runId=randomUUID(),model="isolated-vector-fixtures-"+runId;
for(let i=0;i<80;i++) {
  const id=randomUUID();ids.push(id);const a=100000+i,vector=Array(1536).fill(0);vector[0]=1;vector[1]=i/160;
  await transaction(async db=>{
    await insertQuestion(db,candidateSchema.parse({text:`كم يساوي ${a} زائد 29؟ (اختبار ${runId})`,answer:String(a+29),explanation:`${a}+29=${a+29}.`,hint:"اجمع العددين.",factKey:"vector-fixture:"+id,subject:String(a)+":"+runId,predicate:"fixture-add",fact:`${a}+29=${a+29}`,categoryIds:["vector-check"],difficulty:"easy",deterministic:true,provenance:"Isolated synthetic vector test; no model call"}),id);
    await db.query("INSERT INTO semantic_vectors(question_id,model,embedding,indexed_embedding) VALUES($1,$2,$3,$4::vector)",[id,model,vector,JSON.stringify(vector)]);
  });
}
const target=Array(1536).fill(0);target[0]=1;
const nearest=await nearestSemantic(target,model);assert.equal(nearest[0].question_id,ids[0]);assert.equal(nearest.length,5);
await transaction(async db=>{
  await db.query("SET LOCAL enable_seqscan=off");
  const explain=await db.query("EXPLAIN(FORMAT JSON) SELECT question_id FROM semantic_vectors WHERE indexed_embedding IS NOT NULL ORDER BY indexed_embedding <=> $1::vector LIMIT 5",[JSON.stringify(target)]);
  assert.ok(JSON.stringify(explain.rows).includes("semantic_vectors_hnsw"),"Query must have an HNSW index path");
});
console.log("PASS: actual pgvector/HNSW retrieval selected the expected nearest facts from 80 synthetic vectors.");
await pool.end();
