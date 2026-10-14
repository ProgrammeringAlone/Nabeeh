import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool, transaction } from "../server/db.ts";
import { candidateSchema, ingest } from "../server/content.ts";
const pack = JSON.parse(await readFile("media/release-pack.json","utf8"));
await transaction(async db => {
  for (const c of pack.categories) await db.query("INSERT INTO categories(id,name,description,icon,color) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING", [c.id,c.name,c.description,c.icon,c.color]);
  for (const a of pack.assets) {
    const bytes = await readFile("media/bundle/"+a.objectKey);
    if (bytes.length !== a.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== a.sha256) throw new Error("Release asset integrity failure");
    const saved=await db.query("INSERT INTO media_assets(id,mime,storage,object_key,size_bytes,sha256,credit,license,source) VALUES($1,$2,'bundle',$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET credit=EXCLUDED.credit,license=EXCLUDED.license,source=EXCLUDED.source WHERE media_assets.sha256=EXCLUDED.sha256", [a.id,a.mime,a.objectKey,a.sizeBytes,a.sha256,a.credit,a.license,a.source]);
    if(saved.rowCount!==1) throw new Error("An existing immutable media asset changed. Restore its bytes or create a reviewed new version.");
  }
});
let created = 0;
for (const raw of pack.questions) {
  const c = candidateSchema.parse(raw);
  if ((await pool.query("SELECT 1 FROM candidates WHERE fact_key=$1 UNION SELECT 1 FROM questions WHERE fact_key=$1", [c.factKey])).rowCount) continue;
  await ingest(c);created++;
}
console.log(`Prepared ${created} new review candidates. No question was approved.`);
await pool.end();
