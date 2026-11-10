// Active trained character for a persona, and image generation through it.
// Used by /api/generate (and later remix/ads) so the whole pipeline starts from the LoRA
// instead of reference photos. Everything downstream (metadata strip, save, scoring) is unchanged.

import { isSimulating, simulatedImageUrl } from '@/lib/simulate';
import { supabase } from '@/lib/supabase';
import { INFERENCE, falRun, type CharacterBase } from '@/lib/characters/fal';
import { scoreUrls, scorerConfigured, PASS_SCORE } from '@/lib/scorer';
import { apiKeys } from '@/lib/supabase';
import { runWavespeedJob } from '@/lib/wavespeed-poll';
import { buildInput } from '@/lib/models/manifest';
import { describeSceneForImg2img, sceneSize } from '@/lib/characters/scene';

export interface ActiveCharacter { id: string; name: string; base_model: CharacterBase; lora_url: string; trigger_word: string }

export async function activeCharacterFor(personaId: string, activeCharacterId?: string | null): Promise<ActiveCharacter | null> {
  if (!activeCharacterId) return null;
  const { data } = await supabase.from('characters').select('id, name, base_model, lora_url, trigger_word, status').eq('id', activeCharacterId).eq('persona_id', personaId).single<ActiveCharacter & { status: string }>();
  if (!data || data.status !== 'ready' || !data.lora_url) return null;
  return data;
}

/** True when the base has a LoRA + reference-image endpoint on fal (FLUX.2, FLUX 3 Klein). Z-Image is text-only. */
export function characterCanEdit(ch: ActiveCharacter): boolean { return Boolean(INFERENCE[ch.base_model]?.edit); }
export function isWavespeedEdit(ep: string | null): boolean { return !!ep && ep.startsWith('wavespeed:'); }

/** Best stills of this character (its 4-shot check / highest scored outputs) to use as identity references when the base cannot edit. */
export async function characterReferenceStills(ch: ActiveCharacter, n = 3): Promise<string[]> {
  const { data: gens } = await supabase.from('generations').select('id').eq('character_id', ch.id).order('created_at', { ascending: false }).limit(40);
  const ids = (gens || []).map(g => g.id);
  if (!ids.length) return [];
  const { data: imgs } = await supabase.from('generation_images').select('url, consistency_score').in('generation_id', ids).order('consistency_score', { ascending: false, nullsFirst: false }).limit(n);
  return (imgs || []).map(i => i.url).filter(Boolean);
}

const SIZES: Record<string, string> = { '9:16': 'portrait_16_9', '3:4': 'portrait_4_3', '1:1': 'square_hd', '16:9': 'landscape_16_9', '4:3': 'landscape_4_3' };

export interface CharacterGenOptions { prompt: string; numImages: number; aspectRatio: string; scale?: number; sceneUrl?: string | null; seed?: number; onProgress?: (s: string) => void }

/** Returns public fal URLs. Text mode when no scene; LoRA + reference ("put her in this photo") when a scene is given. */
export async function generateWithCharacter(ch: ActiveCharacter, o: CharacterGenOptions): Promise<{ urls: string[]; model: string; prompt: string; costUsd: number }> {
  const ep = INFERENCE[ch.base_model];
  const T = ch.trigger_word;
  const loras = [{ path: ch.lora_url, scale: Math.min(Math.max(o.scale ?? 1.0, 0.3), 4.0) }];
  const n = Math.min(Math.max(o.numImages, 1), 4);
  if (await isSimulating()) {   // Simulate mode: no provider call, no cost
    o.onProgress?.('Simulating (no provider call)...');
    const url = await simulatedImageUrl(o.aspectRatio);
    return { urls: Array.from({ length: n }, () => url), model: 'simulate', prompt: `${T}, ${o.prompt}`, costUsd: 0 };
  }
  const body = o.prompt.replace(/\s+/g, ' ').trim();
  // Z-Image: the scene path is WaveSpeed img2img + LoRA, not fal. Same request the Character Studio sends:
  // Grok captions the scene (trigger word first), size follows the scene, strength 0.7, one image per call.
  if (o.sceneUrl && isWavespeedEdit(ep.edit)) {
    const endpointId = ep.edit!.slice('wavespeed:'.length);
    o.onProgress?.('Reading the scene...');
    const described = await describeSceneForImg2img(o.sceneUrl, T);
    // Short on purpose: scene caption (trigger first) + the creator's note + the realism wording that fixed
    // Wan video (WAN_REALISM in lib/video-presets.ts), adapted for a still photo.
    const REAL = 'Candid phone photo, natural skin texture with visible pores, natural light, sharp detail.';
    const prompt = described
      ? `${described}${body ? ` ${body.replace(/[.\s]*$/, '')}.` : ''} ${REAL}`
      : `${T}, ${body || 'same pose, framing and setting as the photo'}. ${REAL}`;
    const built = buildInput(endpointId, { strength: 0.7 }, { image: o.sceneUrl, prompt, loras, size: await sceneSize(o.sceneUrl), seed: o.seed });
    o.onProgress?.(`Generating with ${ch.name}...`);
    const urls: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await runWavespeedJob({ endpoint: `https://api.wavespeed.ai/api/v3/${endpointId}`, body: { ...built.body, ...(i ? { seed: -1 } : {}) }, apiKey: apiKeys.wavespeed, tag: 'character', label: ch.name, pollIntervalMs: 2000, maxPolls: 150 });
      urls.push(...r.outputs.filter(Boolean));
    }
    return { urls, model: ep.edit!, prompt, costUsd: Number((n * 0.01).toFixed(3)) };
  }
  let model: string, input: Record<string, unknown>, prompt: string;
  if (o.sceneUrl && ep.edit) {
    model = ep.edit;
    prompt = `${T} in the exact pose, framing, camera angle and setting of the reference image. The person in the output is ${T}: replace the reference person's face, hair and body with ${T}. ${body} Photoreal, natural skin texture.`;
    input = { prompt, image_urls: [o.sceneUrl], loras, num_images: n, enable_prompt_expansion: false, num_inference_steps: ep.steps, ...(ep.guidance != null ? { guidance_scale: ep.guidance } : {}), ...(o.seed != null ? { seed: o.seed } : {}) };
  } else {
    model = ep.text;
    prompt = body.toLowerCase().startsWith(T) ? body : `${T}, ${body}`;
    input = { prompt, loras, num_images: n, image_size: SIZES[o.aspectRatio] || 'portrait_16_9', enable_prompt_expansion: false, num_inference_steps: ep.steps, ...(ep.guidance != null ? { guidance_scale: ep.guidance } : {}), ...(o.seed != null ? { seed: o.seed } : {}) };
  }
  o.onProgress?.(`Generating with ${ch.name}...`);
  const r = await falRun<{ images?: { url: string }[] }>(model, input, { pollMs: 3000, onProgress: o.onProgress });
  const urls = (r.images || []).map(i => i.url).filter(Boolean);
  return { urls, model, prompt, costUsd: Number((n * ep.perMp * 1.2).toFixed(3)) };
}

export interface GatedImage { url: string; score: number | null; rerolled: boolean }

/**
 * Generate, score each image, reroll the ones under the pass bar once, and return the set
 * sorted best first. Without the scorer running this is a plain generate (scores null).
 * Cost is reported so the caller can save it.
 */
export async function generateWithCharacterGated(ch: ActiveCharacter, personaId: string, o: CharacterGenOptions): Promise<{ images: GatedImage[]; model: string; prompt: string; costUsd: number; rerolls: number }> {
  const first = await generateWithCharacter(ch, o);
  let cost = first.costUsd;
  if (!scorerConfigured()) return { images: first.urls.map(url => ({ url, score: null, rerolled: false })), model: first.model, prompt: first.prompt, costUsd: cost, rerolls: 0 };

  o.onProgress?.('Checking faces...');
  const scores = await scoreUrls(first.urls, personaId);
  let images: GatedImage[] = first.urls.map((url, i) => ({ url, score: scores[i], rerolled: false }));
  const misses = images.filter(im => im.score != null && im.score < PASS_SCORE);
  let rerolls = 0;
  if (misses.length) {
    o.onProgress?.(`${misses.length} below ${PASS_SCORE}, rerolling...`);
    const again = await generateWithCharacter(ch, { ...o, numImages: misses.length });
    cost += again.costUsd; rerolls = misses.length;
    const s2 = await scoreUrls(again.urls, personaId);
    const fresh: GatedImage[] = again.urls.map((url, i) => ({ url, score: s2[i], rerolled: true }));
    // keep whichever is better per miss slot
    const keep = images.filter(im => !misses.includes(im));
    misses.forEach((m, i) => { const f = fresh[i]; keep.push(f && (f.score ?? -1) >= (m.score ?? -1) ? f : m); });
    images = keep;
  }
  images.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { images, model: first.model, prompt: first.prompt, costUsd: Number(cost.toFixed(3)), rerolls };
}
