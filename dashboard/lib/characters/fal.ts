// dashboard/lib/characters/fal.ts
//
// fal.ai queue client for character training and LoRA inference.
// Endpoints and prices in one place so the smoke test and the UI read the same numbers.

import { apiKeys } from '@/lib/supabase';

export type CharacterBase = 'qwen' | 'flux2' | 'flux3klein' | 'zimage';

// Verified against fal.ai model pages on 2026-11-05. Every Qwen trainer on fal is DEPRECATED
// (qwen-image-trainer, qwen-image-trainer-v2, qwen-image-edit-2511-trainer): jobs are accepted and never run.
// FLUX.2 [dev] is the live path: trainer `flux-2-trainer-v2`, text `flux-2/lora`, LoRA + up to 4 reference
// images `flux-2/lora/edit`. Re-check these pages before changing anything here.
export const TRAINERS: Record<CharacterBase, { model: string; ratePerStep: number; label: string; minSteps: number; deprecated?: boolean; defaultLr: number; maxRefs: number }> = {
  flux2:      { model: 'fal-ai/flux-2-trainer-v2',                  ratePerStep: 0.0064, label: 'FLUX.2 [dev]',        minSteps: 100, defaultLr: 0.0002, maxRefs: 4 },
  // Verified 2026-11-05: input `images_data_url` (plural), `trigger_phrase`, `resolution` 512/768/1024; output `lora_file`.
  flux3klein: { model: 'blackforestlabs/flux-3/klein/base/trainer', ratePerStep: 0.0043, label: 'FLUX 3 Klein (base)', minSteps: 100, defaultLr: 0.0001, maxRefs: 10 },
  // Verified 2026-11-06: input `image_data_url`, `training_type` content|style|balanced, lr default 0.0001; output `diffusers_lora_file`. $2.26 per 1000 steps.
  zimage:     { model: 'fal-ai/z-image-trainer',                    ratePerStep: 0.00226, label: 'Z-Image Turbo',      minSteps: 100, defaultLr: 0.0001, maxRefs: 0 },
  qwen:       { model: 'fal-ai/qwen-image-trainer-v2',              ratePerStep: 0.002,  label: 'Qwen-Image (deprecated on fal)', minSteps: 500, deprecated: true, defaultLr: 0.0002, maxRefs: 1 },
};

/** App-managed trainer inputs (dataset zip, trigger). Field names differ per trainer; all verified on the fal /api pages. */
export function trainerManaged(base: CharacterBase, zipUrl: string, trigger: string): Record<string, unknown> {
  if (base === 'flux3klein') return { images_data_url: zipUrl, trigger_phrase: trigger };
  return { image_data_url: zipUrl };
}
/** Our defaults for the user-facing trainer fields (what the Advanced row starts from). */
export function trainerDefaults(base: CharacterBase, steps: number): Record<string, unknown> {
  const lr = TRAINERS[base].defaultLr;
  if (base === 'flux3klein') return { steps, learning_rate: lr, resolution: 1024 };
  if (base === 'zimage') return { steps, learning_rate: lr, training_type: 'content' };   // content = subject consistency
  return { steps, learning_rate: lr };
}
/** Legacy: full trainer input without manifest validation. Prefer buildInput(TRAINERS[base].model, params, trainerManaged(...)). */
export function trainerInput(base: CharacterBase, zipUrl: string, steps: number, learningRate: number, trigger: string): Record<string, unknown> {
  return { ...trainerDefaults(base, steps), learning_rate: learningRate, ...trainerManaged(base, zipUrl, trigger) };
}

export const INFERENCE: Record<CharacterBase, { text: string; edit: string | null; perMp: number; steps: number; guidance: number | null }> = {
  flux2:      { text: 'fal-ai/flux-2/lora', edit: 'fal-ai/flux-2/lora/edit', perMp: 0.021, steps: 28, guidance: 2.5 },
  // Klein inference defaults: 50 steps, guidance 3.5, prompt expansion ON by default (we send false so the trigger is not rewritten away).
  flux3klein: { text: 'blackforestlabs/flux-3/klein/base/text-to-image/lora', edit: 'blackforestlabs/flux-3/klein/base/edit-image/lora', perMp: 0.035, steps: 50, guidance: 3.5 },
  // Z-Image Turbo: 8 steps, no guidance_scale field, no LoRA edit endpoint on fal (image-to-image/lora is 404).
  // Z-Image scene path lives on WaveSpeed (fal has none): img2img with LoRA, $0.01/img, strength 0-1.
  zimage:     { text: 'fal-ai/z-image/turbo/lora', edit: 'wavespeed:wavespeed-ai/z-image-turbo/image-to-image-lora', perMp: 0.01, steps: 8, guidance: null },
  qwen:       { text: 'fal-ai/qwen-image', edit: 'fal-ai/qwen-image-edit-plus-lora', perMp: 0.035, steps: 30, guidance: 4 },
};

export { triggerFor, DEFAULT_TRIGGER_PREFIX } from './trigger';

function key(): string {
  const k = apiKeys.fal;
  if (!k) throw new Error('FAL_API_KEY not configured');
  return k;
}

export interface FalSubmit { requestId: string; statusUrl: string; responseUrl: string }

export async function falSubmit(model: string, input: Record<string, unknown>): Promise<FalSubmit> {
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`fal submit ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d = await res.json();
  return {
    requestId: d.request_id,
    statusUrl: d.status_url || `https://queue.fal.run/${model}/requests/${d.request_id}/status`,
    responseUrl: d.response_url || `https://queue.fal.run/${model}/requests/${d.request_id}`,
  };
}

export type FalStatus = { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'; logs?: { message: string }[]; error?: unknown };

/** fal queue URLs use the app id (owner/app) only: for `fal-ai/flux-2/lora` the status URL is
 *  `queue.fal.run/fal-ai/flux-2/requests/<id>/status`. Prefer the status_url/response_url fal returns on submit. */
function appId(model: string): string { return model.split('/').slice(0, 2).join('/'); }

export async function falStatus(model: string, requestId: string, statusUrl?: string): Promise<FalStatus> {
  const url = statusUrl ? `${statusUrl}${statusUrl.includes('?') ? '&' : '?'}logs=1` : `https://queue.fal.run/${appId(model)}/requests/${requestId}/status?logs=1`;
  const res = await fetch(url, { headers: { Authorization: `Key ${key()}` } });
  if (!res.ok) throw new Error(`fal status ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

export async function falResult<T = Record<string, unknown>>(model: string, requestId: string, responseUrl?: string): Promise<T> {
  const res = await fetch(responseUrl || `https://queue.fal.run/${appId(model)}/requests/${requestId}`, { headers: { Authorization: `Key ${key()}` } });
  if (!res.ok) throw new Error(`fal result ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

/** Submit and wait (for inference, which takes seconds). Training uses submit + the poll route instead. */
export async function falRun<T = Record<string, unknown>>(model: string, input: Record<string, unknown>, opts: { pollMs?: number; maxMs?: number; onProgress?: (s: string) => void } = {}): Promise<T> {
  const { requestId, statusUrl, responseUrl } = await falSubmit(model, input);
  const pollMs = opts.pollMs ?? 3000;
  const maxMs = opts.maxMs ?? 10 * 60 * 1000;
  const started = Date.now();
  let lastErr = '';
  for (;;) {
    await new Promise(r => setTimeout(r, pollMs));
    const s = await falStatus(model, requestId, statusUrl).catch((e: Error) => { lastErr = e.message; return null; });
    if (s?.status === 'COMPLETED') return await falResult<T>(model, requestId, responseUrl);
    if (s?.status === 'FAILED') throw new Error(`fal ${model} failed: ${JSON.stringify(s.error || s.logs?.at(-1) || '').slice(0, 300)}`);
    opts.onProgress?.(`${s?.status || 'waiting'} (${Math.round((Date.now() - started) / 1000)}s)`);
    if (Date.now() - started > maxMs) throw new Error(`fal ${model} timed out${lastErr ? ` (last status error: ${lastErr})` : ''}`);
  }
}
