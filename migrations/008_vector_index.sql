-- Neon and other maintained PostgreSQL providers include pgvector. Local installs
-- without its binary remain usable for gameplay and explicit small-library checks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    ALTER TABLE semantic_vectors ADD COLUMN IF NOT EXISTS indexed_embedding vector(1536);
    UPDATE semantic_vectors SET indexed_embedding=array_to_json(embedding)::text::vector
      WHERE array_length(embedding,1)=1536 AND indexed_embedding IS NULL;
    CREATE INDEX IF NOT EXISTS semantic_vectors_hnsw ON semantic_vectors
      USING hnsw(indexed_embedding vector_cosine_ops);
  END IF;
END $$;
