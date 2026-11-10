-- app_settings: key-value store for global application settings
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default provider config
INSERT INTO app_settings (key, value) VALUES
  ('primary_provider', 'wavespeed'),
  ('fallback_provider', 'fal')
ON CONFLICT (key) DO NOTHING;

-- Allow anon access (same pattern as other tables in this project)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to app_settings" ON app_settings
  FOR ALL USING (true) WITH CHECK (true);
