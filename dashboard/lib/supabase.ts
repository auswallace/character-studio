import { createClient } from '@supabase/supabase-js';

// ─── Config ───────────────────────────────────────────────
// Read credentials from environment variables (.env.local)

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment');
}

export { SUPABASE_URL };
// Placeholder values keep `next build` working with no .env.local. Real queries fail until the values are set.
export const supabase = createClient(
  SUPABASE_URL || 'https://missing-supabase-url.invalid',
  SUPABASE_ANON_KEY || 'missing-anon-key',
);

// ─── Model names ─────────────────────────────────────────
// One place to change which Grok model the app talks to.
// VISION: image-in prompts (generate, remix, captions). Unchanged from Session 74.
// TEXT: text-only prompts (scripts, enhance, carousel angles, insights).
//       Was a mix of grok-3-fast / grok-3-mini; consolidated 2026-11-04.
export const GROK_VISION_MODEL = process.env.GROK_VISION_MODEL || 'grok-4-1-fast-non-reasoning';
export const GROK_TEXT_MODEL = process.env.GROK_TEXT_MODEL || 'grok-4-1-fast-non-reasoning';

// ─── API Keys ────────────────────────────────────────────
// Expose API keys for other services (Wavespeed, Grok, Late, etc.)
// Server-side only — these are NOT prefixed with NEXT_PUBLIC_
export const apiKeys = {
  wavespeed: process.env.WAVESPEED_API_KEY || '',
  grok: process.env.GROK_API_KEY || '',
  gemini: process.env.GEMINI_API_KEY || '',
  late: process.env.LATE_API_KEY || '',
  apify: process.env.APIFY_API_KEY || '',
  fal: process.env.FAL_API_KEY || '',
  elevenlabs: process.env.ELEVENLABS_API_KEY || '',
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
};
