import { supabase } from './supabase';

// ─── Template Key Constants ─────────────────────────────
export const TEMPLATE_KEYS = {
  GENERATE_VISION: 'generate:vision_prompt',
  GENERATE_KEYWORDS_SEEDREAM: 'generate:keywords:seedream_4.5',
  GENERATE_KEYWORDS_NANO_PRO: 'generate:keywords:nanobanana_pro',
  GENERATE_KEYWORDS_NANO_2: 'generate:keywords:nanobanana_2',
  REMIX_VISION: 'remix:vision',
  CAPTION_INSTRUCTIONS_SOFI: 'caption:instructions:sofi_belle',
  CAPTION_INSTRUCTIONS_SAMANTHA: 'caption:instructions:samantha_bell',
  CAROUSEL_ANGLE_LEFT: 'carousel:angle_left',
  CAROUSEL_CLOSEUP: 'carousel:closeup',
  CAROUSEL_WIDE: 'carousel:wide',
  CAROUSEL_OVER_SHOULDER: 'carousel:over_shoulder',
} as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[keyof typeof TEMPLATE_KEYS];

// ─── getTemplate ────────────────────────────────────────
/**
 * Fetch a prompt template by key directly from Supabase.
 * Falls back to the provided fallback string on DB miss or error.
 *
 * No in-memory cache — ensures edits from Settings > Prompt Editor
 * take effect immediately, even across Next.js server workers.
 */
export async function getTemplate(key: string, fallback: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('prompt_templates')
      .select('content')
      .eq('key', key)
      .single();

    if (error || !data?.content) {
      return fallback;
    }

    return data.content;
  } catch {
    return fallback;
  }
}

// ─── invalidateTemplateCache (no-op, kept for API compat) ─
export function invalidateTemplateCache(_key?: string): void {
  // No cache to invalidate — queries go directly to Supabase
}
