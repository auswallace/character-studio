import { NextRequest, NextResponse } from 'next/server';
import { supabase, apiKeys, GROK_VISION_MODEL } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';
import { safeFetch } from '@/lib/safe-url';
import { triggerFor } from '@/lib/characters/fal';

// POST /api/characters/dataset/caption  { persona_id, force?: boolean }
// Writes a training caption for every approved dataset image without one.
// Caption = "<trigger>, <scene, outfit, pose, light, camera>" and never her identity.

function systemPrompt(trigger: string): string {
  return `You prepare training data for a character LoRA. The character is ALWAYS the same person and is referred to only by the token "${trigger}".

Return ONLY a JSON object with these keys:
- "caption": one line, 25-60 words, starting with exactly "${trigger}, ". Describe everything EXCEPT the person's identity: clothing (every garment, colors, fit), pose and body position, action, expression type (smiling, neutral), setting, background, lighting (direction, quality), camera (shot type, angle, lens feel), mood. NEVER mention hair color or style, eye color, skin tone, face shape, body type, build, height, age, ethnicity, tattoos.
- "view": one of "face" (head and shoulders, face fills the frame), "half" (waist up), "full" (whole body visible).
- "angle": one of "front", "three_quarter", "profile", "back".
- "issues": array of strings from this list only, empty if none: "multiple_people", "text_or_watermark", "blurry", "face_cropped", "face_hidden", "extreme_angle", "heavy_filter".`;
}

function parseJson(raw: string): { caption?: string; view?: string; angle?: string; issues?: string[] } | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { persona_id, force, mode, limit } = await readJson<{ persona_id?: string; force?: boolean; mode?: 'caption' | 'view'; limit?: number }>(request, 16);
    const batch = Math.max(1, Math.min(50, Number(limit) || 50));
    const viewOnly = mode === 'view';   // label face/half/full + issues only; captions untouched
    if (!persona_id) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    const grokKey = apiKeys.grok;
    if (!grokKey) return NextResponse.json({ error: 'Grok API key not configured' }, { status: 500 });

    const { data: persona } = await supabase.from('personas').select('name').eq('id', persona_id).single<{ name: string }>();
    if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 404 });
    const trigger = triggerFor(persona.name);

    let q = supabase.from('dataset_images').select('id, url, caption').eq('persona_id', persona_id).eq('approved', true);
    if (viewOnly) { if (!force) q = q.is('view', null); }
    else if (!force) q = q.is('caption', null);
    const { data: imgs, error } = await q.order('created_at', { ascending: true }).limit(batch);
    if (error) throw error;

    let done = 0; const failed: string[] = [];
    for (const img of imgs || []) {
      try {
        const res = await safeFetch(img.url, { purpose: 'dataset caption' });
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        const g = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${grokKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: GROK_VISION_MODEL, temperature: 0.3, max_tokens: 300,
            messages: [
              { role: 'system', content: systemPrompt(trigger) },
              { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}`, detail: 'high' } }, { type: 'text', text: 'Caption this image.' }] },
            ],
          }),
        });
        if (!g.ok) throw new Error(`grok ${g.status}`);
        const d = await g.json();
        const raw = String(d.choices?.[0]?.message?.content || '');
        const parsed = parseJson(raw);
        let cap = String(parsed?.caption || raw).trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
        if (!cap.toLowerCase().startsWith(trigger)) cap = `${trigger}, ${cap.replace(/^[,\s]+/, '')}`;
        cap = cap.replace(/\b(blonde?|brunette|platinum|silver|grey|gray|red|black|brown)\s+hair\b/gi, 'hair').replace(/\btattoos?\b/gi, '');
        const view = ['face', 'half', 'full'].includes(String(parsed?.view)) ? String(parsed?.view) : null;
        const angle = ['front', 'three_quarter', 'profile', 'back'].includes(String(parsed?.angle)) ? String(parsed?.angle) : null;
        const issues = Array.isArray(parsed?.issues) ? parsed!.issues!.filter(x => typeof x === 'string').slice(0, 6).join(',') : '';
        await supabase.from('dataset_images').update({ caption: viewOnly ? undefined : cap, view: view ? (angle ? `${view}:${angle}` : view) : undefined, issues: issues || null, approved: issues.includes('multiple_people') || issues.includes('face_hidden') ? false : undefined }).eq('id', img.id);
        done++;
      } catch (e) { failed.push(`${img.id}: ${e instanceof Error ? e.message : e}`); }
    }
    let rq = supabase.from('dataset_images').select('id', { count: 'exact', head: true }).eq('persona_id', persona_id).eq('approved', true);
    rq = viewOnly ? rq.is('view', null) : rq.is('caption', null);
    const { count: remaining } = await rq;
    return NextResponse.json({ captioned: done, failed, trigger, remaining: force ? 0 : (remaining || 0) });
  } catch (e) { return errorResponse(e, 'characters/dataset/caption'); }
}
