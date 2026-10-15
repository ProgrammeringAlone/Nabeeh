-- Optional editorial targets preserve existing queued jobs while giving new jobs
-- an explicit difficulty, presentation format and regional scope.
ALTER TABLE generation_jobs
  ADD COLUMN target_difficulty text CHECK(target_difficulty IN ('easy','medium','hard','expert')),
  ADD COLUMN target_format text CHECK(target_format IN ('text','choice','ordering','word')),
  ADD COLUMN target_region text CHECK(target_region IN ('all','sa','kw','ae','bh','qa','om'));

-- Workers still serialize one active job per category/kind. These columns are
-- not an approval instruction: every generated candidate enters human review.
CREATE INDEX candidates_editorial_targets ON candidates
  ((payload->>'difficulty'), (payload->>'format'), (payload->>'region'), status);
