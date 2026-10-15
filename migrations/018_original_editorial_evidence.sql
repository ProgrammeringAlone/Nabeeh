-- Human-reviewed, original puzzles have an editorial proof instead of a web URL.
ALTER TABLE evidence DROP CONSTRAINT evidence_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_check
  CHECK (url IS NOT NULL OR verification_method IN ('deterministic','editorial-original'));
