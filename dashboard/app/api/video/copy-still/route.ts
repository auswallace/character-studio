import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { safeFetch } from '@/lib/safe-url';
import { extractFirstFrame } from '@/lib/video-thumbnail';

// POST /api/video/copy-still  { videoUrl, persona?, note?, count? }
//
// "Copy motion" step 1: take the first frame of the motion video and run it through Image Copy with the
// persona's trained character, so she stands in that frame with the same pose, outfit and framing.
// The stills come back for approval; the chosen one is the character image for Wan Animate / Kling Motion.
// The image work is done by /api/generate (same path as the Image Copy tab), so prompts and face checks match.

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl : '';
    if (!/^https:\/\//.test(videoUrl)) return NextResponse.json({ error: 'videoUrl is required' }, { status: 400 });
    const count = Math.min(Math.max(Number(body.count) || 2, 1), 4);

    // Persona: the one given, else the first persona that has an active trained character.
    let persona = typeof body.persona === 'string' ? body.persona : '';
    if (!persona) {
      const { data } = await supabase.from('personas').select('name').not('active_character_id', 'is', null).limit(1);
      persona = data?.[0]?.name || '';
    }
    if (!persona) return NextResponse.json({ error: 'No persona with a trained character. Set one active in Character Studio.' }, { status: 400 });

    const res = await safeFetch(videoUrl, { purpose: 'motion video', trustedProviderUrl: true });
    if (!res.ok) return NextResponse.json({ error: `Could not download the motion video: ${res.status}` }, { status: 400 });
    const frame = await extractFirstFrame(Buffer.from(await res.arrayBuffer()), { seekSeconds: 0, quality: 2, maxWidth: 1080 });
    const frameUrl = await uploadFile('video-pipeline', `uploads/${crypto.randomUUID()}/first-frame.jpg`, frame, 'image/jpeg');

    const gen = await fetch(`${request.nextUrl.origin}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, promptImage: frame.toString('base64'), promptNote: typeof body.note === 'string' ? body.note : '', useCharacter: true, numImages: count }),
    });
    const text = await gen.text();
    if (!gen.ok) return NextResponse.json({ error: `Still generation failed: ${text.slice(0, 200)}` }, { status: 502 });
    const stills: { url: string; score: number | null }[] = [];
    let error = '';
    for (const block of text.split('\n\n')) {
      const ev = /^event: (\w+)/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
      if (!ev || !data) continue;
      try {
        const d = JSON.parse(data);
        if (ev === 'image' && d.url) stills[d.index ?? stills.length] = { url: d.url, score: typeof d.score === 'number' ? d.score : null };
        if (ev === 'error') error = d.error || d.message || 'generation error';
      } catch { /* not JSON */ }
    }
    const out = stills.filter(Boolean);
    if (!out.length) return NextResponse.json({ error: error || 'No still came back' }, { status: 502 });
    return NextResponse.json({ frameUrl, persona, stills: out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
