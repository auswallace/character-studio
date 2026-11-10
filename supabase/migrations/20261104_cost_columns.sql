-- Cost per generation, computed from lib/pricing.ts (providers do not return the charge).
-- cost_source: 'rate_card' (published price), 'estimate' (derived), 'unknown'.
ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(8,4);
ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS cost_source TEXT;
ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS inference_ms INTEGER;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(8,4);
ALTER TABLE generations ADD COLUMN IF NOT EXISTS cost_source TEXT;
ALTER TABLE remixes ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(8,4);
ALTER TABLE remixes ADD COLUMN IF NOT EXISTS cost_source TEXT;
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(8,4);
ALTER TABLE carousels ADD COLUMN IF NOT EXISTS cost_source TEXT;
