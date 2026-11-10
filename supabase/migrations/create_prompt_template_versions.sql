-- Create prompt_template_versions table for tracking prompt template changes
CREATE TABLE IF NOT EXISTS prompt_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ptv_key ON prompt_template_versions(template_key);
CREATE INDEX IF NOT EXISTS idx_ptv_key_version ON prompt_template_versions(template_key, version DESC);

ALTER TABLE prompt_template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON prompt_template_versions FOR ALL TO anon USING (true) WITH CHECK (true);
