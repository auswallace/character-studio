import { NextRequest, NextResponse } from 'next/server';
import { backfillScores, scoreRecord, scorerConfigured, type ScoreKind } from '@/lib/scorer';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';

// ─── Types ────────────────────────────────────────────────
interface ScoreBody {
  kind?: ScoreKind;
  ids?: string[];
  backfill?: number;
}

const KINDS: ScoreKind[] = ['generation', 'remix', 'carousel'];
const IMAGE_TABLES: Record<ScoreKind, { images: string; fk: string }> = {
  generation: { images: 'generation_images', fk: 'generation_id' },
  remix: { images: 'remix_images', fk: 'remix_id' },
  carousel: { images: 'carousel_images', fk: 'carousel_id' },
};

// ─── GET ──────────────────────────────────────────────────
// ?kind=generation&parent_ids=a,b  -> { configured, scores: { [imageUrl]: { score, faces, view } | null } }
//                                     null = not scored yet
// (no params)                       -> scorer health
export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind') as ScoreKind | null;
  const rawIds = request.nextUrl.searchParams.get('parent_ids');
  if (kind && rawIds) {
    if (!KINDS.includes(kind)) return NextResponse.json({ error: 'bad kind' }, { status: 400 });
    const ids = rawIds.split(',').filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 60);
    const t = IMAGE_TABLES[kind];
    const scores: Record<string, { score: number | null; faces: number; view: string | null } | null> = {};
    if (ids.length) {
      const { data, error } = await supabase.from(t.images).select('url, consistency_score, face_count, face_view, scored_at').in(t.fk, ids);
      if (!error) {
        for (const r of (data || []) as { url: string; consistency_score: number | null; face_count: number | null; face_view: string | null; scored_at: string | null }[]) {
          scores[r.url] = r.scored_at ? { score: r.consistency_score == null ? null : Number(r.consistency_score), faces: r.face_count ?? 0, view: r.face_view } : null;
        }
      }
    }
    return NextResponse.json({ configured: scorerConfigured(), scores });
  }

  const base = (process.env.SCORER_URL || '').replace(/\/$/, '');
  if (!base) return NextResponse.json({ configured: false, ok: false });
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    return NextResponse.json({ configured: true, ok: res.ok, ...(res.ok ? await res.json() : {}) });
  } catch {
    return NextResponse.json({ configured: true, ok: false });
  }
}

// ─── POST: score records, or backfill ─────────────────────
// { kind: 'generation', ids: [...] }  -> score those records now
// { backfill: 100 }                   -> score up to 100 unscored images, newest first
export async function POST(request: NextRequest) {
  try {
    if (!scorerConfigured()) {
      return NextResponse.json({ error: 'SCORER_URL is not set. Start scripts/scorer/run.sh and add SCORER_URL to .env.local.' }, { status: 400 });
    }
    const body = await readJson<ScoreBody>(request, 32);

    if (body.backfill !== undefined) {
      const limit = Math.min(Math.max(Number(body.backfill) || 0, 1), 500);
      return NextResponse.json({ success: true, ...(await backfillScores(limit)) });
    }

    if (!body.kind || !KINDS.includes(body.kind)) {
      return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
    }
    const ids = (body.ids || []).filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
    if (ids.length === 0) return NextResponse.json({ error: 'ids is required' }, { status: 400 });

    let scored = 0;
    for (const id of ids) scored += await scoreRecord(body.kind, id);
    return NextResponse.json({ success: true, scored });
  } catch (e) {
    return errorResponse(e, 'scores');
  }
}
