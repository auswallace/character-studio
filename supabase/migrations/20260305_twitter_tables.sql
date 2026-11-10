-- Twitter Content Intelligence System tables

-- Scraped tweets from influencer accounts for style analysis
CREATE TABLE IF NOT EXISTS twitter_style_sources (
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

CREATE INDEX IF NOT EXISTS idx_twitter_style_account ON twitter_style_sources(source_account);
CREATE INDEX IF NOT EXISTS idx_twitter_style_engagement ON twitter_style_sources(engagement_score DESC);

-- Enable RLS with open access (same pattern as other tables)
ALTER TABLE twitter_style_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON twitter_style_sources FOR ALL USING (true) WITH CHECK (true);

-- Generated tweet content
CREATE TABLE IF NOT EXISTS twitter_content (
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

CREATE INDEX IF NOT EXISTS idx_twitter_content_session ON twitter_content(session_number);
CREATE INDEX IF NOT EXISTS idx_twitter_content_status ON twitter_content(status);
CREATE INDEX IF NOT EXISTS idx_twitter_content_bank ON twitter_content(is_tweet_bank) WHERE is_tweet_bank = true;

ALTER TABLE twitter_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON twitter_content FOR ALL USING (true) WITH CHECK (true);
