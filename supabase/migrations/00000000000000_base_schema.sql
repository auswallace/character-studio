-- Base schema. Run this file first, then the other files in this folder in name order.
-- Creates the core tables, the storage buckets, and open anon policies
-- (single-user tool with no login: do not expose it on the public internet without auth in front).

-- ─── Personas (replaces Configuration table) ─────────
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  traits TEXT,
  api_provider TEXT DEFAULT 'Wavespeed',
  prompt_provider TEXT DEFAULT 'Grok',
  enable_nsfw BOOLEAN DEFAULT false,
  num_images INTEGER DEFAULT 4,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Persona reference images ────────────────────────
CREATE TABLE persona_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('face', 'body')),
  slot INTEGER NOT NULL CHECK (slot IN (0, 1)),
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(persona_id, ref_type, slot)
);

CREATE INDEX idx_persona_refs_persona ON persona_refs(persona_id);

-- ─── Generations (replaces Generation table) ─────────
CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  persona TEXT NOT NULL,
  persona_id UUID REFERENCES personas(id),
  image_model TEXT,
  prompt TEXT,
  prompt_note TEXT,
  prompt_image_url TEXT,
  error_message TEXT,
  duration_seconds REAL,
  all_images_deleted BOOLEAN DEFAULT false,
  starred BOOLEAN DEFAULT false,
  drive_synced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_generations_persona ON generations(persona);
CREATE INDEX idx_generations_starred ON generations(starred) WHERE starred = true;
CREATE INDEX idx_generations_created ON generations(created_at DESC);

-- ─── Generation images ───────────────────────────────
CREATE TABLE generation_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER,
  width INTEGER,
  height INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg',
  is_upscaled BOOLEAN DEFAULT false,
  original_image_id UUID REFERENCES generation_images(id),
  sort_order INTEGER DEFAULT 0,
  wavespeed_request_id TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gen_images_generation ON generation_images(generation_id);

-- ─── Remixes (replaces Image Remix table) ────────────
CREATE TABLE remixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  persona TEXT NOT NULL,
  persona_id UUID REFERENCES personas(id),
  image_model TEXT,
  hero_image_url TEXT,
  remix_prompt TEXT,
  enhanced_prompt TEXT,
  enhance_prompt BOOLEAN DEFAULT true,
  num_images INTEGER DEFAULT 3,
  error_message TEXT,
  duration_seconds REAL,
  all_images_deleted BOOLEAN DEFAULT false,
  starred BOOLEAN DEFAULT false,
  drive_synced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_remixes_persona ON remixes(persona);
CREATE INDEX idx_remixes_created ON remixes(created_at DESC);

-- ─── Remix images ────────────────────────────────────
CREATE TABLE remix_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remix_id UUID NOT NULL REFERENCES remixes(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER,
  width INTEGER,
  height INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg',
  is_upscaled BOOLEAN DEFAULT false,
  original_image_id UUID REFERENCES remix_images(id),
  sort_order INTEGER DEFAULT 0,
  wavespeed_request_id TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_remix_images_remix ON remix_images(remix_id);

-- ─── Carousel Tables ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS carousels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  persona TEXT NOT NULL,
  persona_id UUID REFERENCES personas(id),
  image_model TEXT,
  carousel_set_id UUID,
  prompt_template_key TEXT,
  prompt TEXT,
  notes TEXT,
  source_image_url TEXT,
  error_message TEXT,
  duration_seconds REAL,
  starred BOOLEAN DEFAULT false,
  provider TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carousels_persona ON carousels(persona);
CREATE INDEX IF NOT EXISTS idx_carousels_created_at ON carousels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_carousels_set_id ON carousels(carousel_set_id);

CREATE TABLE IF NOT EXISTS carousel_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carousel_id UUID NOT NULL REFERENCES carousels(id) ON DELETE CASCADE,
  storage_path TEXT,
  url TEXT,
  filename TEXT,
  size INTEGER,
  width INTEGER,
  height INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg',
  is_upscaled BOOLEAN DEFAULT false,
  original_image_id UUID,
  sort_order INTEGER,
  wavespeed_request_id TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carousel_images_carousel ON carousel_images(carousel_id);

-- ─── Social Posts ────────────────────────────────────
CREATE TABLE social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'Pending Captions',
  persona TEXT NOT NULL,
  platforms TEXT[] DEFAULT '{}',
  caption_instagram TEXT,
  caption_twitter TEXT,
  caption_tiktok TEXT,
  caption_threads TEXT,
  notes TEXT,
  schedule_date TIMESTAMPTZ,
  schedule_mode TEXT,
  published_urls TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_social_posts_status ON social_posts(status);
CREATE INDEX idx_social_posts_persona ON social_posts(persona);
CREATE INDEX idx_social_posts_schedule ON social_posts(schedule_date);

-- ─── Social post media ───────────────────────────────
CREATE TABLE social_post_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image',
  width INTEGER,
  height INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_post_media_post ON social_post_media(post_id);

-- ─── Scraped Posts (IG Scraper) ──────────────────────
CREATE TABLE scraped_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  post_url TEXT,
  caption TEXT,
  post_date TIMESTAMPTZ,
  likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  use_for_generation BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scraped_username ON scraped_posts(username);
CREATE INDEX idx_scraped_favorites ON scraped_posts(use_for_generation) WHERE use_for_generation = true;

-- ─── Scraped post images (carousel) ──────────────────
CREATE TABLE scraped_post_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES scraped_posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scraped_images_post ON scraped_post_images(post_id);

-- ─── X Scraped Content (X Reposter) ─────────────────
CREATE TABLE x_scraped_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_tweet_id TEXT UNIQUE NOT NULL,
  source_account TEXT NOT NULL,
  image_url TEXT,
  storage_path TEXT,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  bookmarks INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  engagement_score NUMERIC GENERATED ALWAYS AS (
    likes + (bookmarks * 2) + (retweets * 3)
  ) STORED,
  rewritten_caption TEXT,
  status TEXT DEFAULT 'New',
  post_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_x_scraped_status ON x_scraped_content(status);
CREATE INDEX idx_x_scraped_engagement ON x_scraped_content(engagement_score DESC);
CREATE INDEX idx_x_scraped_tweet_id ON x_scraped_content(original_tweet_id);

-- ─── Video Jobs (Video Replicator) ───────────────────
CREATE TABLE video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_link TEXT,
  source_video_url TEXT,
  source_video_path TEXT,
  ai_character_url TEXT,
  cover_image_url TEXT,
  video_output_url TEXT,
  video_output_path TEXT,
  status TEXT DEFAULT 'Pending',
  error_details TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Updated_at trigger ──────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_personas_updated BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_generations_updated BEFORE UPDATE ON generations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_remixes_updated BEFORE UPDATE ON remixes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_social_posts_updated BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_video_jobs_updated BEFORE UPDATE ON video_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_carousels_updated BEFORE UPDATE ON carousels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Dev Tickets ────────────────────────────────────────
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

-- ─── Twitter Content Intelligence ────────────────────

CREATE TABLE twitter_style_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_account TEXT NOT NULL,
  tweet_id TEXT UNIQUE NOT NULL,
  tweet_text TEXT NOT NULL,
  tweet_type TEXT DEFAULT 'single',
  thread_id TEXT,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  engagement_score INTEGER GENERATED ALWAYS AS (likes + retweets * 3 + replies * 2) STORED,
  tweet_date TIMESTAMPTZ,
  tweet_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_twitter_style_account ON twitter_style_sources(source_account);
CREATE INDEX idx_twitter_style_engagement ON twitter_style_sources(engagement_score DESC);

CREATE TABLE twitter_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number INTEGER NOT NULL,
  session_date DATE NOT NULL,
  tweet_type TEXT NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  engagement_prediction TEXT,
  strategy_note TEXT,
  status TEXT DEFAULT 'draft',
  is_tweet_bank BOOLEAN DEFAULT false,
  tweet_bank_tag TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_twitter_content_session ON twitter_content(session_number);
CREATE INDEX idx_twitter_content_status ON twitter_content(status);
CREATE INDEX idx_twitter_content_bank ON twitter_content(is_tweet_bank) WHERE is_tweet_bank = true;

-- ─── Storage Buckets ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES
  ('persona-refs', 'persona-refs', true),
  ('generated-images', 'generated-images', true),
  ('remix-images', 'remix-images', true),
  ('social-media', 'social-media', true),
  ('scraped-content', 'scraped-content', true),
  ('x-reposter', 'x-reposter', true),
  ('video-pipeline', 'video-pipeline', true),
  ('carousel-images', 'carousel-images', true);

-- ─── Storage Policies (public read, anon write) ──────
CREATE POLICY "Public read" ON storage.objects FOR SELECT TO anon
  USING (bucket_id IN ('persona-refs', 'generated-images', 'remix-images', 'social-media', 'scraped-content', 'x-reposter', 'video-pipeline', 'carousel-images'));

CREATE POLICY "Allow uploads" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id IN ('persona-refs', 'generated-images', 'remix-images', 'social-media', 'scraped-content', 'x-reposter', 'video-pipeline', 'carousel-images'));

CREATE POLICY "Allow updates" ON storage.objects FOR UPDATE TO anon
  USING (bucket_id IN ('persona-refs', 'generated-images', 'remix-images', 'social-media', 'scraped-content', 'x-reposter', 'video-pipeline', 'carousel-images'));

CREATE POLICY "Allow deletes" ON storage.objects FOR DELETE TO anon
  USING (bucket_id IN ('persona-refs', 'generated-images', 'remix-images', 'social-media', 'scraped-content', 'x-reposter', 'video-pipeline', 'carousel-images'));

-- ─── RLS: Allow anon access to all tables (server-side only) ───
-- Our Next.js API routes and CLI tools use the anon key server-side.
-- No public client access — all requests go through our API routes.
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE remixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE remix_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraped_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraped_post_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE x_scraped_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE carousels ENABLE ROW LEVEL SECURITY;
ALTER TABLE carousel_images ENABLE ROW LEVEL SECURITY;

-- Allow full access for anon role (our server uses anon key)
CREATE POLICY "anon_all" ON personas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON persona_refs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON generations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON generation_images FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON remixes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON remix_images FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON social_posts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON social_post_media FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON scraped_posts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON scraped_post_images FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON x_scraped_content FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON video_jobs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON carousels FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON carousel_images FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─── Prompt Templates (editable from Settings > Prompt Editor) ─────────
CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON prompt_templates FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Prompt template version history ─────────────────────────────────
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

-- ── Scrape cost tracking ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrape_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,           -- 'ig' or 'x'
  username TEXT NOT NULL,
  posts_scraped INTEGER DEFAULT 0,
  cost_usd NUMERIC(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_platform ON scrape_runs(platform);

ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON scrape_runs FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─── Video generations and outputs ───────────────────
CREATE TABLE IF NOT EXISTS video_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  video_model TEXT NOT NULL,
  video_mode TEXT NOT NULL DEFAULT 'image_to_video',
  prompt TEXT,
  negative_prompt TEXT,
  source_image_url TEXT,
  source_image_path TEXT,
  end_image_url TEXT,
  end_image_path TEXT,
  reference_video_url TEXT,
  reference_video_path TEXT,
  duration INTEGER DEFAULT 5,
  aspect_ratio TEXT DEFAULT '16:9',
  resolution TEXT DEFAULT '1080p',
  generate_audio BOOLEAN DEFAULT false,
  model_params JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pending',
  error_details TEXT,
  provider TEXT,
  provider_request_id TEXT,
  provider_input JSONB,
  starred BOOLEAN DEFAULT false,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_generations_persona ON video_generations(persona_id);
CREATE INDEX IF NOT EXISTS idx_video_generations_model ON video_generations(video_model);
CREATE INDEX IF NOT EXISTS idx_video_generations_status ON video_generations(status);
CREATE INDEX IF NOT EXISTS idx_video_generations_created ON video_generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_generations_starred ON video_generations(starred) WHERE starred = true;

CREATE TABLE IF NOT EXISTS video_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_generation_id UUID NOT NULL REFERENCES video_generations(id) ON DELETE CASCADE,
  url TEXT,
  storage_path TEXT,
  filename TEXT,
  duration_seconds NUMERIC,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  mime_type TEXT DEFAULT 'video/mp4',
  has_audio BOOLEAN DEFAULT false,
  provider_request_id TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_outputs_generation ON video_outputs(video_generation_id);

ALTER TABLE video_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON video_generations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON video_outputs FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─── Post ideas (Publish > Drafts) ───────────────────
CREATE TABLE IF NOT EXISTS post_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona TEXT NOT NULL,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  caption_draft TEXT DEFAULT '',
  platform TEXT DEFAULT 'ig',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE post_ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to post_ideas" ON post_ideas FOR ALL USING (true) WITH CHECK (true);
