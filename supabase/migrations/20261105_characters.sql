-- Trained characters ("aura" / LoRA) per persona + their training datasets.
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,                    -- "Samantha v2"
  base_model TEXT NOT NULL,              -- 'qwen' | 'flux2'
  trigger_word TEXT NOT NULL,
  lora_url TEXT, config_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | training | ready | failed | retired
  training_run_id TEXT, training_model TEXT,
  dataset_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  dataset_zip_url TEXT,
  steps INTEGER, learning_rate NUMERIC,
  cost_usd NUMERIC(8,4), eval_mean NUMERIC(5,4), error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), trained_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS dataset_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL DEFAULT 'library',
  source_image_id UUID,
  url TEXT NOT NULL, storage_path TEXT,
  view TEXT, caption TEXT, score NUMERIC(5,4),
  approved BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (persona_id, url)
);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS body_traits TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS active_character_id UUID;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS kling_element_id TEXT;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS character_id UUID;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS consistency_score NUMERIC(5,4);
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON characters FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON dataset_images FOR ALL TO anon USING (true) WITH CHECK (true);
-- bucket for dataset zips, scene uploads, character outputs
INSERT INTO storage.buckets (id, name, public) VALUES ('persona-datasets', 'persona-datasets', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "anon_datasets_bucket" ON storage.objects FOR ALL TO anon USING (bucket_id = 'persona-datasets') WITH CHECK (bucket_id = 'persona-datasets');
ALTER TABLE dataset_images ADD COLUMN IF NOT EXISTS issues TEXT;  -- Grok flags: multiple people, text, blur, cropped face

-- 2026-11-05 (later): remixes can be made by a trained character too
ALTER TABLE remixes ADD COLUMN IF NOT EXISTS character_id UUID REFERENCES characters(id) ON DELETE SET NULL;
ALTER TABLE remixes ADD COLUMN IF NOT EXISTS cost_source TEXT;
ALTER TABLE dataset_images ADD COLUMN IF NOT EXISTS slot TEXT;   -- catalog slot key (lib/characters/catalog.ts) for generated images

-- 2026-11-06: named dataset selections (Save set as… / Load)
CREATE TABLE IF NOT EXISTS dataset_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_ids UUID[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE dataset_sets ENABLE ROW LEVEL SECURITY;
