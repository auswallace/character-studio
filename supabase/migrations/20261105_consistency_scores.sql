-- Per-image face-consistency scores written by the scorer service (scripts/scorer/).
-- Parent rows keep the best score of their batch for quick sorting/badges.
-- scored_at is set even when no face was found, so backfill does not retry forever.
ALTER TABLE generation_images ADD COLUMN IF NOT EXISTS consistency_score NUMERIC(5,4);
ALTER TABLE generation_images ADD COLUMN IF NOT EXISTS face_count SMALLINT;
ALTER TABLE generation_images ADD COLUMN IF NOT EXISTS face_view TEXT;
ALTER TABLE generation_images ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

ALTER TABLE remix_images ADD COLUMN IF NOT EXISTS consistency_score NUMERIC(5,4);
ALTER TABLE remix_images ADD COLUMN IF NOT EXISTS face_count SMALLINT;
ALTER TABLE remix_images ADD COLUMN IF NOT EXISTS face_view TEXT;
ALTER TABLE remix_images ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

ALTER TABLE carousel_images ADD COLUMN IF NOT EXISTS consistency_score NUMERIC(5,4);
ALTER TABLE carousel_images ADD COLUMN IF NOT EXISTS face_count SMALLINT;
ALTER TABLE carousel_images ADD COLUMN IF NOT EXISTS face_view TEXT;
ALTER TABLE carousel_images ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

-- generations.consistency_score already added in 20261105_characters.sql
ALTER TABLE remixes   ADD COLUMN IF NOT EXISTS consistency_score NUMERIC(5,4);
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS consistency_score NUMERIC(5,4);

CREATE INDEX IF NOT EXISTS idx_gen_images_unscored      ON generation_images(created_at DESC) WHERE scored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_remix_images_unscored    ON remix_images(created_at DESC)      WHERE scored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_carousel_images_unscored ON carousel_images(created_at DESC)   WHERE scored_at IS NULL;
