import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse } from '@/lib/http';

// GET /api/characters/[id]/results
// Everything made with this character version, newest first, with the 4-shot check runs marked.
// { results: [{ id, name, prompt, check, images: [{ url, score }], created_at }] }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data: gens, error } = await supabase.from('generations').select('id, name, prompt, prompt_image_url, provider_input, created_at').eq('character_id', id).order('created_at', { ascending: false }).limit(120);
    if (error) throw error;
    const ids = (gens || []).map(g => g.id);
    const { data: imgs } = ids.length ? await supabase.from('generation_images').select('generation_id, url, sort_order, consistency_score, is_upscaled, filename').in('generation_id', ids).order('sort_order') : { data: [] };
    // Upscaled copies are stored as extra generation_images rows (filename upscaled_idx<N>.png). They are the same
    // result at 4K, not a new result: attach them to image N as upscaledUrl instead of listing them twice.
    const byGen = new Map<string, { url: string; score: number | null; upscaledUrl?: string }[]>();
    const all = imgs || [];
    for (const im of all.filter(i => !i.is_upscaled)) { const l = byGen.get(im.generation_id) || []; l.push({ url: im.url, score: im.consistency_score ?? null }); byGen.set(im.generation_id, l); }
    for (const up of all.filter(i => i.is_upscaled)) {
      const n = Number(/idx(\d+)/.exec(up.filename || '')?.[1] ?? 0);
      const target = byGen.get(up.generation_id)?.[n];
      if (target) target.upscaledUrl = up.url;
    }
    const results = (gens || []).map(g => ({ id: g.id, name: g.name, prompt: g.prompt, sceneUrl: g.prompt_image_url, check: /_check$/.test(g.name || ''), images: byGen.get(g.id) || [], created_at: g.created_at, providerInput: g.provider_input || null }));
    return NextResponse.json({ results });
  } catch (e) { return errorResponse(e, 'characters/results'); }
}
