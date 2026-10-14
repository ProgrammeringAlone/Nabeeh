-- Correct the existing development fixture without replacing its canonical ID.
UPDATE questions SET options='["9","3","7"]'::jsonb,ordering_answer='["3","7","9"]'::jsonb
 WHERE fact_key='ordering:3-7-9' AND format='ordering' AND ordering_answer IS NULL;
CREATE TABLE replenishment_requests (
  category_id text NOT NULL REFERENCES categories(id),
  difficulty text NOT NULL,
  region text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY(category_id,difficulty,region)
);
