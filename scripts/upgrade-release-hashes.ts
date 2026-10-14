// One-time correction of this unapproved starter pack's legacy text-only hashes.
// Approved questions, rejected drafts, and unrelated editorial work are untouched.
import {pool,transaction} from "../server/db.ts";
import {candidateSchema,contentDigest,digest} from "../server/content.ts";
import {randomUUID} from "node:crypto";
await transaction(async db=>{
  const {rows}=await db.query("SELECT * FROM candidates WHERE fact_key LIKE 'release-v1:%' AND status IN('review','duplicate') AND payload->>'provenance'='Original Nabeeh release pack v1. Human review required; not auto-approved.' FOR UPDATE");
  for(const row of rows) {
    const c=candidateSchema.parse(row.payload);
    if((!c.media && c.format!=="ordering") || row.normalized_hash!==digest(c.text)) continue;
    const hash=await contentDigest(db,c);
    const duplicate=(await db.query("SELECT 1 FROM questions WHERE normalized_hash=$1 OR fact_key=$2 OR fact_signature=$3",[hash,c.factKey,row.fact_signature])).rowCount;
    await db.query("UPDATE candidates SET normalized_hash=$2,status=$3,reason=$4 WHERE id=$1",[row.id,hash,duplicate?"duplicate":"review",duplicate?"exact-or-canonical-fact":null]);
    if(!duplicate) await db.query("INSERT INTO review_tasks(id,candidate_id,kind) SELECT $1,$2,'source-and-semantic' WHERE NOT EXISTS(SELECT 1 FROM review_tasks WHERE candidate_id=$2)",[randomUUID(),row.id]);
  }
});
await pool.end();
