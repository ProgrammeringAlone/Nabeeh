import { pool, transaction } from "../server/db.ts";
import { factSignature } from "../server/semantic.ts";
await transaction(async (db) => {
  const { rows } = await db.query(
    "SELECT id,subject,predicate,answer FROM questions WHERE fact_signature IS NULL",
  );
  for (const q of rows)
    await db.query("UPDATE questions SET fact_signature=$2 WHERE id=$1", [
      q.id,
      factSignature(q),
    ]);
  console.log("Indexed", rows.length, "canonical fact signatures.");
});
await pool.end();
