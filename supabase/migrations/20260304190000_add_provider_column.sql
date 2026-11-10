-- Add provider column to generations and remixes tables
-- Tracks which API provider (wavespeed, fal) was used for image generation
ALTER TABLE generations ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE remixes ADD COLUMN IF NOT EXISTS provider TEXT;
