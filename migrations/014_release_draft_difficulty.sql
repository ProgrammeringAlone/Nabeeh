-- Correct untouched starter-pack drafts; retain all editorial decisions and identities.
WITH changed AS (
  UPDATE candidates AS c
  SET payload = jsonb_set(c.payload, '{difficulty}', to_jsonb(v.new_level)),
      revision = c.revision + 1
  FROM (VALUES
    ('release-v1:logic:original-calculation:48*29', 'easy', 'hard'),
    ('release-v1:logic:original-calculation:19+26', 'medium', 'easy'),
    ('release-v1:logic:original-calculation:53+27', 'hard', 'medium')
  ) AS v(fact_key, old_level, new_level)
  WHERE c.fact_key = v.fact_key
    AND c.status IN ('review', 'duplicate')
    AND c.revision = 1
    AND c.payload->>'difficulty' = v.old_level
  RETURNING c.id, v.old_level, v.new_level
)
INSERT INTO audit_logs(action, target, metadata)
SELECT 'correct-release-draft-difficulty', id::text,
       jsonb_build_object('old', old_level, 'new', new_level,
         'reason', 'Rebalance untouched arithmetic starter drafts before human approval.')
FROM changed;
