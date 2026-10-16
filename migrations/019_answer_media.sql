ALTER TABLE questions ADD COLUMN answer_media_id uuid REFERENCES media_assets(id);
ALTER TABLE questions ADD COLUMN answer_media_alt text;
ALTER TABLE questions ADD CONSTRAINT question_answer_media_description CHECK (
  (answer_media_id IS NULL AND answer_media_alt IS NULL)
  OR (answer_media_id IS NOT NULL AND answer_media_alt IS NOT NULL AND length(answer_media_alt) BETWEEN 5 AND 500)
);
