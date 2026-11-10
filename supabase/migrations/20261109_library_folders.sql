-- Library folders (Gallery). An image is in at most one folder; no row = unfiled.
-- Applied to the live project on 2026-11-09. Same anon policy pattern as the other tables.
CREATE TABLE IF NOT EXISTS library_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS library_folder_items (
  source text NOT NULL,            -- generation | remix | carousel | video
  record_id uuid NOT NULL,
  image_index int NOT NULL DEFAULT 0,
  folder_id uuid NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, record_id, image_index)
);
CREATE INDEX IF NOT EXISTS library_folder_items_folder_idx ON library_folder_items(folder_id);
ALTER TABLE library_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_folder_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON library_folders FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON library_folder_items FOR ALL TO anon USING (true) WITH CHECK (true);

-- Notes on a Library image (one per image). Applied 2026-11-09.
CREATE TABLE IF NOT EXISTS library_notes (
  source text NOT NULL,
  record_id uuid NOT NULL,
  image_index int NOT NULL DEFAULT 0,
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, record_id, image_index)
);
ALTER TABLE library_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON library_notes FOR ALL TO anon USING (true) WITH CHECK (true);
