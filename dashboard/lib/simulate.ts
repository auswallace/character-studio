// dashboard/lib/simulate.ts
//
// Simulate mode (Settings > Providers, or forced by env: see simulateForced). When on, image generation returns a labelled placeholder
// instead of calling fal or WaveSpeed, so UI work and flows can be tested at no image cost.
// Covers the provider router (Create, Copy, Remix, Carousel) and the trained-character path.
// Every other paid route (video, training, Character Studio, ads) refuses while it is on: see
// assertSpendAllowed() in lib/spend-guard.ts. Prompt writing (Grok/Gemini) still runs and still costs.

import sharp from 'sharp';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';

const KEY = 'simulate_generation';
const CACHE_MS = 15_000;
let cache: { at: number; on: boolean } | null = null;

/**
 * Forced on when SIMULATE=true, or when no image provider key is set. A fresh clone with an empty
 * .env therefore starts in simulate mode and cannot spend money. The Settings toggle cannot turn it off.
 */
export function simulateForced(): boolean {
  if (process.env.SIMULATE === 'true') return true;
  return !process.env.FAL_API_KEY && !process.env.WAVESPEED_API_KEY;
}

export async function isSimulating(): Promise<boolean> {
  if (simulateForced()) return true;
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.on;
  let on = false;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle<{ value: string }>();
    on = data?.value === 'true';
  } catch { /* setting unreadable: treat as off */ }
  cache = { at: now, on };
  return on;
}
export function invalidateSimulateCache(): void { cache = null; }

const DIMS: Record<string, [number, number]> = { '9:16': [864, 1536], '3:4': [960, 1280], '4:5': [1024, 1280], '1:1': [1024, 1024], '16:9': [1536, 864], '4:3': [1280, 960] };
const made = new Map<string, string>();

/** Public URL of a grey placeholder at the given aspect ratio ("9:16") or pixel size ("1728x2304"). Made once per shape. */
export async function simulatedImageUrl(shape: string | undefined): Promise<string> {
  let [w, h] = DIMS[shape || ''] || [0, 0];
  const px = /^(\d+)\s*[x*]\s*(\d+)$/i.exec(shape || '');
  if (px) { const W = Number(px[1]), H = Number(px[2]); const k = 1280 / Math.max(W, H); w = Math.round(W * k); h = Math.round(H * k); }
  if (!w || !h) [w, h] = DIMS['9:16'];
  const key = `${w}x${h}`;
  const hit = made.get(key); if (hit) return hit;
  const fs = Math.round(Math.min(w, h) / 12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#D9D6D0"/><rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="#8A867E" stroke-width="4" stroke-dasharray="18 14"/><text x="50%" y="48%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" font-weight="700" fill="#4A4741">SIMULATED</text><text x="50%" y="${48 + 100 * fs / h}%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(fs * 0.5)}" fill="#4A4741">${w} x ${h} · no provider call</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  const url = await uploadFile('generated-images', `_simulate/placeholder_${key}.jpg`, buf, 'image/jpeg');
  made.set(key, url);
  return url;
}
