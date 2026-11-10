// dashboard/lib/deidentify.ts
//
// Scene de-identify ("pose only" mode): one Nano Banana 2.1 edit call that swaps the
// person in a scene photo for a featureless grey mannequin with the same pose, build,
// clothing, framing, light and background. Feeding the mannequin (not the real person)
// to a character LoRA keeps the scene's identity from leaking into the output.
//
// This is NOT one of the generate/remix/carousel templates. It is its own prompt,
// used only by the Character tab today. The prompt text is untested: check the
// first outputs for pose drift before relying on it.
//
// Cached per scene URL: the same scene costs one edit call, ever.

import { createHash } from 'crypto';
import { supabase, apiKeys } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { assertSafeUrl } from '@/lib/safe-url';
import { fetchImageAsJpeg } from '@/lib/fetch-image';
import { runWavespeedJob } from '@/lib/wavespeed-poll';

const ENDPOINT = 'https://api.wavespeed.ai/api/v3/google/nano-banana-2.1/edit';
const BUCKET = 'persona-datasets';
const FOLDER = 'mannequins';
export const DEIDENTIFY_COST_USD = 0.04; // rate card estimate, NB 2.1 edit at 1-2K

export const MANNEQUIN_PROMPT =
  'Replace the person in this photo with a featureless matte light-grey mannequin of the same body build, ' +
  'proportions and exact pose. The mannequin has a smooth blank head with no face, no hair, no skin detail. ' +
  'Keep the clothing, accessories, framing, camera angle, lighting, shadows and background exactly the same. ' +
  'Change nothing else in the image.';

export interface DeidentifyResult { url: string; cached: boolean; costUsd: number }

export async function deidentifyScene(sceneUrl: string, aspectRatio?: string): Promise<DeidentifyResult> {
  assertSafeUrl(sceneUrl, { purpose: 'deidentify scene' });
  const key = createHash('sha256').update(sceneUrl).digest('hex').slice(0, 32);
  const path = `${FOLDER}/${key}.jpg`;

  const { data: existing } = await supabase.storage.from(BUCKET).list(FOLDER, { search: `${key}.jpg`, limit: 1 });
  if (existing && existing.some(f => f.name === `${key}.jpg`)) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, cached: true, costUsd: 0 };
  }

  const body: Record<string, unknown> = {
    prompt: MANNEQUIN_PROMPT,
    images: [sceneUrl],
    resolution: '2k',
    output_format: 'png',
    enable_base64_output: false,
  };
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const job = await runWavespeedJob({ endpoint: ENDPOINT, body, apiKey: apiKeys.wavespeed, tag: 'deidentify', label: 'Nano Banana 2.1 mannequin', pollIntervalMs: 3000, maxPolls: 60 });
  const clean = await fetchImageAsJpeg(job.outputs[0]);
  const url = await uploadFile(BUCKET, path, clean, 'image/jpeg');
  console.log(`[deidentify] ${key}: mannequin saved (${(clean.length / 1024).toFixed(0)} KB)`);
  return { url, cached: false, costUsd: DEIDENTIFY_COST_USD };
}
