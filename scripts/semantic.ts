import { pool } from "../server/db.ts";
import { indexQuestion, inspectSemantic } from "../server/semantic.ts";
if (!process.env.MODEL_API_KEY)
  throw new Error(
    "Set MODEL_API_KEY securely to enable external semantic retrieval.",
  );
const { rows: questions } = await pool.query(
  "SELECT q.id FROM questions q LEFT JOIN semantic_vectors v ON v.question_id=q.id WHERE v.question_id IS NULL LIMIT 100",
);
for (const q of questions) await indexQuestion(q.id);
const { rows: candidates } = await pool.query(
  "SELECT c.id FROM candidates c LEFT JOIN candidate_vectors v ON v.candidate_id=c.id WHERE c.status='review' AND v.candidate_id IS NULL LIMIT 20",
);
for (const c of candidates) await inspectSemantic(c.id);
console.log(
  "Semantic index processed",
  questions.length,
  "questions and",
  candidates.length,
  "candidates.",
);
await pool.end();
