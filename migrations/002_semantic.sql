ALTER TABLE questions ADD COLUMN fact_signature text;
CREATE UNIQUE INDEX canonical_fact_signature ON questions(fact_signature) WHERE fact_signature IS NOT NULL;
ALTER TABLE candidates ADD COLUMN fact_signature text;
CREATE TABLE semantic_vectors (question_id uuid PRIMARY KEY REFERENCES questions(id), model text NOT NULL, embedding double precision[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE candidate_vectors (candidate_id uuid PRIMARY KEY REFERENCES candidates(id), model text NOT NULL, embedding double precision[] NOT NULL);
CREATE TABLE semantic_judgments (candidate_id uuid NOT NULL REFERENCES candidates(id), question_id uuid NOT NULL REFERENCES questions(id), verdict text NOT NULL CHECK(verdict IN('same-fact','different','uncertain')), reason text NOT NULL, provider text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(candidate_id,question_id));
