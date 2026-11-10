import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';
import { scorerConfigured } from '@/lib/scorer';

// POST /api/characters/dataset/score  { persona_id }
// Scores every dataset image against the mean face of the set (the scorer's canonical for this persona)
// and writes dataset_images.score. Low scores = the images pulling the character away from herself.

interface Res { image_url: string; similarity?: number | null; faces?: number; error?: string }

export async function POST(request: NextRequest) {
  try {
    const { persona_id } = await readJson<{ persona_id?: string }>(request, 8);
    if (!persona_id) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    if (!scorerConfigured()) return NextResponse.json({ error: 'Scorer not running. Start scripts/scorer/run.sh and set SCORER_URL in .env.local.' }, { status: 503 });
    const base = (process.env.SCORER_URL || '').replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.SCORER_TOKEN) headers.Authorization = `Bearer ${process.env.SCORER_TOKEN}`;

    // The canonical face is built from approved face images; rebuild it so removed/added images count.
    await fetch(`${base}/refresh`, { method: 'POST', headers, body: JSON.stringify({ persona_id }) }).catch(() => {});

    const { data: imgs, error } = await supabase.from('dataset_images').select('id, url').eq('persona_id', persona_id);
    if (error) throw error;
    const rows = (imgs || []) as { id: string; url: string }[];
    let scored = 0, noFace = 0; const all: number[] = [];
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = rows.slice(i, i + 20);
      const res = await fetch(`${base}/score/batch`, { method: 'POST', headers, body: JSON.stringify({ items: chunk.map(r => ({ image_url: r.url, persona_id })) }) });
      if (!res.ok) throw new Error(`scorer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const { results } = (await res.json()) as { results: Res[] };
      const by = new Map(results.map(r => [r.image_url, r]));
      for (const r of chunk) {
        const s = by.get(r.url);
        const sim = s?.similarity ?? null;
        const issues = s && s.faces != null && s.faces > 1 ? 'multiple_people' : s && s.faces === 0 ? 'face_hidden' : null;
        await supabase.from('dataset_images').update({ score: sim, ...(issues ? { issues } : {}) }).eq('id', r.id);
        if (sim != null) { scored++; all.push(sim); } else noFace++;
      }
    }
    all.sort((a, b) => a - b);
    const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    return NextResponse.json({ scored, noFace, mean: mean != null ? Number(mean.toFixed(3)) : null, p10: all.length ? Number(all[Math.floor(all.length * 0.1)].toFixed(3)) : null, min: all[0] ?? null, max: all[all.length - 1] ?? null });
  } catch (e) { return errorResponse(e, 'characters/dataset/score'); }
}
