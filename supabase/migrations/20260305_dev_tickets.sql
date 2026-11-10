-- Dev Tickets — task tracking for the dashboard

CREATE TABLE IF NOT EXISTS dev_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Dashboard',
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Open',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dev_tickets_status ON dev_tickets(status);
CREATE INDEX IF NOT EXISTS idx_dev_tickets_category ON dev_tickets(category);

ALTER TABLE dev_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON dev_tickets FOR ALL USING (true) WITH CHECK (true);

-- Seed from existing TICKETS.md
INSERT INTO dev_tickets (title, description, category, priority, status) VALUES
  ('Reduce body reference images in Image Copy', 'Currently sends 5 reference images (feels excessive). Reduce body refs by 1 to cut down on noise for the image model.', 'Pipeline', 'Medium', 'Open'),
  ('Generate route still sends preamble to Wavespeed', 'Legacy behavior from before Session 50 fix. Remix route strips it; generate route needs the same treatment.', 'Pipeline', 'Medium', 'Open');
