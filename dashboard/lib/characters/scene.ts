// dashboard/lib/characters/scene.ts
// Helpers for img2img with a character LoRA (WaveSpeed Z-Image). Shared by the Character Studio route and
// the main pipeline (lib/characters/active.ts), so both send the same request for the same scene.

import sharp from 'sharp';
import { apiKeys, GROK_VISION_MODEL } from '@/lib/supabase';
import { safeFetch } from '@/lib/safe-url';

// img2img needs a description of the target image, not an instruction. Grok describes the scene
// (framing, pose, clothes, setting, light) without the person's identity; the trigger word supplies that.
export async function describeSceneForImg2img(sceneUrl: string, trigger: string): Promise<string> {
  const key = apiKeys.grok;
  if (!key) return '';
  try {
    const res = await safeFetch(sceneUrl, { purpose: 'scene caption', trustedProviderUrl: true });
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    const g = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GROK_VISION_MODEL, temperature: 0.2, max_tokens: 220, messages: [
        { role: 'system', content: `Describe this photo as a caption for an image model, one line, 30-60 words: shot type and camera angle, exact body pose and where the hands and legs are, where the person looks, clothing, setting and background, lighting. Do NOT describe the person's face, hair, skin, age, body type or identity. Start with "${trigger}, ". No quotes.` },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}`, detail: 'high' } }, { type: 'text', text: 'Caption.' }] },
      ] }),
    });
    if (!g.ok) return '';
    const d = await g.json();
    let cap = String(d.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
    if (!cap.toLowerCase().startsWith(trigger)) cap = `${trigger}, ${cap.replace(/^[,\s]+/, '')}`;
    return cap;
  } catch { return ''; }
}

export async function sceneSize(sceneUrl: string): Promise<string> {
  try {
    const res = await safeFetch(sceneUrl, { purpose: 'scene size', trustedProviderUrl: true });
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    const w = meta.width || 1024, h = meta.height || 1024;
    const short = 1024, long = Math.round((Math.max(w, h) / Math.min(w, h)) * short / 16) * 16;
    return w >= h ? `${Math.min(long, 1536)}*${short}` : `${short}*${Math.min(long, 1536)}`;
  } catch { return '1024*1024'; }
}

