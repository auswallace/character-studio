// dashboard/lib/pricing.ts
//
// Rate card for cost-per-generation. Wavespeed does not return the charge in
// its API response, so cost is computed from published rates. Every estimate is
// tagged with its source so the data layer knows how much to trust it.
//
// Update this file when prices change; the `verified` date says when it was last checked.

import { VIDEO_MODELS } from '@/lib/video-providers/types';

export type CostSource = 'rate_card' | 'estimate' | 'unknown';

interface VideoRate { perSecond: number; soundSurcharge?: number; source: CostSource; verified: string; note?: string }
interface ImageRate { perImage: number; source: CostSource; verified: string; note?: string }

// ─── Video (Wavespeed, USD per output second) ─────────────
const VIDEO_RATES: Record<string, VideoRate> = {
  [VIDEO_MODELS.KLING_O3]:          { perSecond: 0.112, soundSurcharge: 0.25, source: 'rate_card', verified: '2026-11-04', note: 'Wavespeed docs: $0.112/s, +25% with sound' },
  [VIDEO_MODELS.KLING_V3]:          { perSecond: 0.112, soundSurcharge: 0.25, source: 'estimate', verified: '2026-11-04', note: 'assumed same as O3; UI card said ~$1.12/10s' },
  [VIDEO_MODELS.KLING_MOTION]:      { perSecond: 0.112, source: 'estimate', verified: '2026-04-27', note: 'UI card said ~$0.56/5s' },
  [VIDEO_MODELS.SEEDANCE_1_5]:      { perSecond: 0.052, source: 'estimate', verified: '2026-04-27', note: 'UI card said ~$0.26/5s' },
  [VIDEO_MODELS.SEEDANCE_2_0]:      { perSecond: 0.30,  source: 'estimate', verified: '2026-11-04', note: 'fal.ai 720p w/ audio $0.30/s; Wavespeed not confirmed' },
  [VIDEO_MODELS.SEEDANCE_2_5]:      { perSecond: 0.30,  source: 'estimate', verified: '2026-11-04', note: 'no published price yet; assumed = 2.0. Check Wavespeed billing after first runs' },
  [VIDEO_MODELS.VEO_3_1]:           { perSecond: 0.10,  source: 'estimate', verified: '2026-04-27', note: 'veo3.1-fast; UI card said ~$0.80/8s' },
  [VIDEO_MODELS.GEMINI_OMNI_FLASH]: { perSecond: 0.10,  source: 'estimate', verified: '2026-11-04', note: 'article: ~$6/min = $0.10/s' },
  [VIDEO_MODELS.WAN_ANIMATE]:       { perSecond: 0.08,  source: 'rate_card', verified: '2026-11-10', note: 'WaveSpeed wan-2.2/animate 720p: $0.40 per 5 s; 480p is $0.04/s' },
  [VIDEO_MODELS.WAN_2_2]:           { perSecond: 0.07,  source: 'rate_card', verified: '2026-11-09', note: 'WaveSpeed wan-2.2/i2v-720p-lora: $0.35 per 5 s, $0.56 for 8 s' },
};

// ─── Images (Wavespeed, USD per output image) ─────────────
const IMAGE_RATES: Record<string, ImageRate> = {
  'Nanobanana Pro':   { perImage: 0.113, source: 'estimate', verified: '2026-11-04', note: 'NB 2.1 4K rate used as proxy' },
  'Nanobanana 2':     { perImage: 0.0504, source: 'estimate', verified: '2026-11-04', note: 'NB 2.1 2K rate used as proxy' },
  'Nanobanana 2.1':   { perImage: 0.036, source: 'rate_card', verified: '2026-11-04', note: 'Wavespeed: from $0.036/output (1K); 2K/4K cost more' },
  'Seedream 5.0 Lite':{ perImage: 0.035, source: 'rate_card', verified: '2026-11-04', note: 'Wavespeed docs: $0.035 x max_images' },
  'Seedream 4.5':     { perImage: 0.03,  source: 'estimate', verified: '2026-04-27' },
  'Seedream 4.0':     { perImage: 0.03,  source: 'estimate', verified: '2026-04-27' },
};

export interface CostEstimate { costUsd: number | null; source: CostSource; note?: string }

export function videoCost(model: string, seconds: number, withSound: boolean): CostEstimate {
  const r = VIDEO_RATES[model];
  if (!r || !seconds) return { costUsd: null, source: 'unknown' };
  const mult = withSound && r.soundSurcharge ? 1 + r.soundSurcharge : 1;
  return { costUsd: Math.round(r.perSecond * seconds * mult * 1000) / 1000, source: r.source, note: r.note };
}

export function imageCost(model: string, numImages: number): CostEstimate {
  const r = IMAGE_RATES[model];
  if (!r || !numImages) return { costUsd: null, source: 'unknown' };
  return { costUsd: Math.round(r.perImage * numImages * 1000) / 1000, source: r.source, note: r.note };
}
