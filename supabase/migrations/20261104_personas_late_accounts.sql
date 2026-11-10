-- Late (getlate.dev) account IDs per persona, keyed by Late platform name.
-- Replaces the hardcoded INSTAGRAM_ACCOUNTS / THREADS_ACCOUNTS maps in send-to-late.
-- Applied to the hosted project 2026-11-04.
ALTER TABLE personas ADD COLUMN IF NOT EXISTS late_accounts JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN personas.late_accounts IS 'Map of Late platform -> Late account id, e.g. {"instagram":"...","threads":"..."}';
-- Seed values for the two existing personas were applied as data (not repeated here).
