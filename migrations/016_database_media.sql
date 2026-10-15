-- Private uploads remain durable on the free pilot without an object-store account.
-- Separate byte storage keeps editorial lists and question queries small.
ALTER TABLE media_assets DROP CONSTRAINT media_assets_storage_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_storage_check CHECK(storage IN ('bundle','object','database'));
ALTER TABLE media_assets DROP CONSTRAINT media_assets_mime_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_mime_check CHECK(mime IN ('image/svg+xml','image/png','image/jpeg','image/webp','audio/wav','audio/ogg','audio/mpeg','video/webm','video/mp4'));
CREATE TABLE media_blobs (
  asset_id uuid PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 10485760)
);
CREATE INDEX media_assets_recent ON media_assets(created_at DESC,id DESC);
