// dashboard/lib/scorer.ts
//
// Client for the face-consistency scorer (scripts/scorer/, FastAPI + ArcFace).
// Writes consistency_score / face_count / face_view / scored_at on image rows and
// the best score of the batch on the parent row.
//
// Everything here is best effort: when SCORER_URL is unset or the scorer is down,
// calls return quietly. Generation must never wait on or fail because of scoring.
// Columns come from supabase/migrations/20261105_consistency_scores.sql.

import { supabase } from '@/lib/supabase';

export type ScoreKind = 'generation' | 'remix' | 'carousel';

const TABLES: Record<ScoreKind, { parent: string; images: string; fk: string }> = {
  generation: { parent: 'generations', images: 'generation_images', fk: 'generation_id' },
  remix: { parent: 'remixes', images: 'remix_images', fk: 'remix_id' },
  carousel: { parent: 'carousels', images: 'carousel_images', fk: 'carousel_id' },
};

const BATCH = 25;

interface ScoreResult {
  image_url: string;
  similarity?: number | null;
  faces?: number;
  view?: string;
  error?: string;
}

export function scorerConfigured(): boolean {
  return Boolean(process.env.SCORER_URL);
}

async function callBatch(items: { image_url: string; persona_id: string }[]): Promise<ScoreResult[]> {
  const base = (process.env.SCORER_URL || '').replace(/\/$/, '');
  if (!base || items.length === 0) return [];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.SCORER_TOKEN) headers.Authorization = `Bearer ${process.env.SCORER_TOKEN}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(`${base}/score/batch`, { method: 'POST', headers, body: JSON.stringify({ items }), signal: ctrl.signal });
    if (!res.ok) throw new Error(`scorer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { results?: ScoreResult[] };
    return data.results || [];
  } finally {
    clearTimeout(timer);
  }
}

/** Score raw URLs now (no DB). null when the scorer is off or fails. Used by the generate gate. */
export async function scoreUrls(urls: string[], personaId: string): Promise<(number | null)[]> {
  if (!scorerConfigured() || !urls.length) return urls.map(() => null);
  try {
    const r = await callBatch(urls.map(u => ({ image_url: u, persona_id: personaId })));
    const by = new Map(r.map(x => [x.image_url, x.similarity ?? null]));
    return urls.map(u => by.get(u) ?? null);
  } catch (e) { console.warn('[scorer] scoreUrls failed:', e instanceof Error ? e.message : e); return urls.map(() => null); }
}

export const PASS_SCORE = 0.60;

/**
 * Score every unscored image of one parent record (a generation, remix or carousel).
 * Returns the number of images scored. Throws only on programmer error; scorer and
 * DB failures are logged and swallowed.
 */
export async function scoreRecord(kind: ScoreKind, parentId: string): Promise<number> {
  if (!scorerConfigured() || !parentId) return 0;
  const t = TABLES[kind];
  try {
    const { data: parent } = await supabase.from(t.parent).select('id, persona_id').eq('id', parentId).single<{ id: string; persona_id: string | null }>();
    if (!parent?.persona_id) return 0;

    const { data: imgs, error } = await supabase
      .from(t.images)
      .select('id, url')
      .eq(t.fk, parentId)
      .is('scored_at', null);
    if (error) { console.warn(`[scorer] ${t.images} query failed (migration applied?): ${error.message}`); return 0; }
    const rows = (imgs || []).filter((r: { url: string | null }) => r.url) as { id: string; url: string }[];
    if (rows.length === 0) {
      // All images already scored (the generate gate does this inline): still roll the best up to the parent.
      const { data: all } = await supabase.from(t.images).select('consistency_score').eq(t.fk, parentId).not('consistency_score', 'is', null);
      const best = Math.max(...((all || []) as { consistency_score: number }[]).map(r => Number(r.consistency_score)), -1);
      if (best > -1) await supabase.from(t.parent).update({ consistency_score: best }).eq('id', parentId);
      return 0;
    }

    let scored = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const results = await callBatch(chunk.map(r => ({ image_url: r.url, persona_id: parent.persona_id as string })));
      const byUrl = new Map(results.map(r => [r.image_url, r]));
      await Promise.allSettled(chunk.map(async r => {
        const s = byUrl.get(r.url);
        if (!s || s.error) { if (s?.error) console.warn(`[scorer] ${r.id}: ${s.error}`); return; }
        const { error: upErr } = await supabase.from(t.images).update({
          consistency_score: s.similarity ?? null,
          face_count: s.faces ?? 0,
          face_view: s.view || null,
          scored_at: new Date().toISOString(),
        }).eq('id', r.id);
        if (!upErr) scored++;
      }));
    }

    // Parent keeps the best score of its batch (badge + sort key).
    const { data: all } = await supabase.from(t.images).select('consistency_score').eq(t.fk, parentId).not('consistency_score', 'is', null);
    const best = Math.max(...((all || []) as { consistency_score: number }[]).map(r => Number(r.consistency_score)), -1);
    if (best > -1) await supabase.from(t.parent).update({ consistency_score: best }).eq('id', parentId);

    console.log(`[scorer] ${kind} ${parentId}: scored ${scored}/${rows.length}`);
    return scored;
  } catch (err) {
    console.warn(`[scorer] ${kind} ${parentId} skipped: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/** Fire-and-forget wrapper for use right after a save. Never throws, never awaited. */
export function scoreRecordInBackground(kind: ScoreKind, parentId: string | null | undefined): void {
  if (!parentId || !scorerConfigured()) return;
  void scoreRecord(kind, parentId).catch(() => { /* best effort */ });
}

/**
 * Backfill: find parents with unscored images, newest first, and score them until
 * about `limit` images are done. Returns counts so the caller can loop.
 */
export async function backfillScores(limit = 100): Promise<{ scored: number; parents: number; remaining: number }> {
  let scored = 0;
  let parents = 0;
  for (const kind of Object.keys(TABLES) as ScoreKind[]) {
    if (scored >= limit) break;
    const t = TABLES[kind];
    const { data, error } = await supabase
      .from(t.images)
      .select(`${t.fk}`)
      .is('scored_at', null)
      .eq('is_upscaled', false)
      .order('created_at', { ascending: false })
      .limit(Math.max(limit - scored, 1) * 2);
    if (error) throw new Error(`${t.images}: ${error.message} (apply 20261105_consistency_scores.sql)`);
    const ids = [...new Set(((data || []) as unknown as Record<string, string>[]).map(r => r[t.fk]))];
    for (const id of ids) {
      if (scored >= limit) break;
      const n = await scoreRecord(kind, id);
      scored += n;
      parents++;
    }
  }
  let remaining = 0;
  for (const t of Object.values(TABLES)) {
    const { count } = await supabase.from(t.images).select('id', { count: 'exact', head: true }).is('scored_at', null).eq('is_upscaled', false);
    remaining += count || 0;
  }
  return { scored, parents, remaining };
}
