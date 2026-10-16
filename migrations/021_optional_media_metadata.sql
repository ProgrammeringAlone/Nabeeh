-- Administrative uploads do not require ownership or licensing declarations.
-- Preserve existing supplied metadata without inventing values for new files.
ALTER TABLE media_assets
  ALTER COLUMN credit DROP NOT NULL,
  ALTER COLUMN license DROP NOT NULL;
