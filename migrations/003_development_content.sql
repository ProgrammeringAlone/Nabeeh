ALTER TABLE questions ADD COLUMN development_only boolean NOT NULL DEFAULT false;
UPDATE questions SET development_only=true WHERE provenance LIKE 'Original Nabeeh development seed%';
