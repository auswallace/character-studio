import { NextRequest, NextResponse } from 'next/server';
import { apiKeys, GROK_TEXT_MODEL } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';

// POST /api/create/takes  { note, persona?, count? }
// Turns a rough idea ("gym mirror selfie, morning") into N distinct shot notes the user can pick from.
// These are NOT the final prompts: the chosen take goes to /api/generate as promptNote and Grok
// expands it there with the normal template. This is only "give me four angles on my idea".

export async function POST(request: NextRequest) {
  try {
    const { note, count } = await readJson<{ note?: string; persona?: string; count?: number }>(request, 8);
    const n = Math.min(Math.max(Number(count) || 4, 2), 6);
    if (!note?.trim()) return NextResponse.json({ error: 'note required' }, { status: 400 });
    const key = apiKeys.grok;
    if (!key) return NextResponse.json({ error: 'Grok API key not configured' }, { status: 500 });

    const system = `You help a creator plan social photos of one recurring character (a woman). Given a rough idea, return ${n} different takes on it as a JSON array of strings. Each take is one sentence, 12-30 words, describing: framing (close-up / waist-up / full body), setting, what she is doing, lighting, mood. Vary framing and setting across the takes. Never describe her face, hair, skin or body. Plain language, no hashtags, no quotes. Return ONLY the JSON array.`;
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GROK_TEXT_MODEL, temperature: 0.9, max_tokens: 600, messages: [{ role: 'system', content: system }, { role: 'user', content: note.trim().slice(0, 500) }] }),
    });
    if (!res.ok) throw new Error(`grok ${res.status}`);
    const d = await res.json();
    const raw = String(d.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    let takes: string[] = [];
    try { takes = JSON.parse(raw); } catch { const m = raw.match(/\[[\s\S]*\]/); if (m) { try { takes = JSON.parse(m[0]); } catch { /* ignore */ } } }
    takes = (Array.isArray(takes) ? takes : []).filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean).slice(0, n);
    if (!takes.length) takes = raw.split('\n').map(l => l.replace(/^[\s\-*\d.)"]+/, '').trim()).filter(l => l.length > 15).slice(0, n);
    return NextResponse.json({ takes });
  } catch (e) { return errorResponse(e, 'create/takes'); }
}
