CREATE TABLE recovery_keys (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE questions DROP CONSTRAINT questions_format_check;
ALTER TABLE questions ADD CONSTRAINT questions_format_check CHECK (format IN ('text','choice','ordering','word','image','audio','video'));
CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  mime text NOT NULL CHECK (mime IN ('image/svg+xml','image/png','image/jpeg','image/webp','audio/wav','audio/ogg','video/webm','video/mp4')),
  storage text NOT NULL CHECK(storage IN ('bundle','object')),
  object_key text NOT NULL UNIQUE,
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL,
  credit text NOT NULL,
  license text NOT NULL,
  source text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE questions ADD COLUMN media_id uuid REFERENCES media_assets(id);
ALTER TABLE questions ADD COLUMN media_alt text;
ALTER TABLE questions ADD COLUMN media_transcript text;
ALTER TABLE questions ADD COLUMN ordering_answer jsonb;
ALTER TABLE game_questions ADD COLUMN response jsonb;
CREATE INDEX questions_selection ON questions(difficulty,id) WHERE status='approved';
CREATE INDEX question_entity ON questions(subject,predicate);
CREATE INDEX question_answer ON questions(lower(answer));
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX question_text_search ON questions USING gin(text gin_trgm_ops);
