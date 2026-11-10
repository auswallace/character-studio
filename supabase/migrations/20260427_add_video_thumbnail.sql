-- Add thumbnail columns to video_outputs
-- thumbnail_url: public URL of the JPEG poster frame extracted at generation time
-- thumbnail_storage_path: bucket-relative path so we can delete it on record delete
ALTER TABLE video_outputs ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE video_outputs ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT;
