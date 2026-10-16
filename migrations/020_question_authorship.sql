-- Creation origin is trusted metadata, separate from editable question payloads.
ALTER TABLE candidates ADD COLUMN creation_kind text NOT NULL DEFAULT 'unknown'
  CHECK (creation_kind IN ('admin','ai','generator','unknown'));
ALTER TABLE candidates ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE candidates ADD CHECK (created_by IS NULL OR creation_kind='admin');
ALTER TABLE questions ADD COLUMN creation_kind text NOT NULL DEFAULT 'unknown'
  CHECK (creation_kind IN ('admin','ai','generator','unknown'));
ALTER TABLE questions ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE questions ADD CHECK (created_by IS NULL OR creation_kind='admin');

-- A reviewer's identity does not establish authorship. Only authenticated manual
-- submission audit records establish a legacy human author. Payload provenance
-- is editable and cannot establish an AI or human origin by itself.
WITH manual AS (
  SELECT DISTINCT ON (a.target) a.target,a.actor_id
  FROM audit_logs a
  WHERE a.action='submit-question'
  ORDER BY a.target,a.created_at,a.id
)
UPDATE candidates c SET creation_kind='admin',created_by=m.actor_id
FROM manual m WHERE m.target=c.id::text;
UPDATE questions q SET creation_kind=c.creation_kind,created_by=c.created_by
FROM candidates c WHERE q.id=c.id AND c.creation_kind='admin';

-- A recorded human approval is evidence of editorial review, not a claim that
-- the administrator owns the material or that a web reference was checked.
ALTER TABLE evidence DROP CONSTRAINT evidence_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_check
  CHECK (url IS NOT NULL OR verification_method IN ('deterministic','editorial-original','editorial-admin'));
