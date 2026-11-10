import { safeFetch } from '@/lib/safe-url';
import { supabase, apiKeys } from './supabase';
import { uploadFile } from './storage';

const UPSCALE_ENDPOINT = 'https://api.wavespeed.ai/api/v3/wavespeed-ai/image-upscaler';

/**
 * Upscale a single image via WaveSpeed. Returns the upscaled image as a Buffer.
 * Uses sync mode — blocks for 2-10 seconds per image.
 */
async function upscaleImage(imageUrl: string, wavespeedKey: string): Promise<Buffer> {
  const res = await fetch(UPSCALE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${wavespeedKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: imageUrl,
      target_resolution: '4k',
      output_format: 'png',
      enable_sync_mode: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WaveSpeed upscale failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  const upscaledUrl = data?.data?.outputs?.[0];
  if (!upscaledUrl) throw new Error('No upscaled URL in WaveSpeed response');

  // Download the upscaled image to a buffer for storage upload
  const imgRes = await safeFetch(upscaledUrl, { purpose: 'upscale output', trustedProviderUrl: true });
  if (!imgRes.ok) throw new Error(`Failed to download upscaled image: ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

interface GenerationImage {
  id: string;
  generation_id: string;
  storage_path: string | null;
  url: string | null;
  filename: string | null;
  is_upscaled: boolean;
  original_image_id: string | null;
  sort_order: number | null;
}

/**
 * Fire-and-forget: upscale image(s) on a generation and upload to Storage.
 *
 * When imageIndex is provided, only upscales that specific image (single-image star).
 * When imageIndex is undefined, upscales all images (legacy/batch behavior).
 *
 * Filenames encode the original index (e.g., upscaled_idx0.png) so the frontend
 * can match upscaled images back to their originals regardless of upload order.
 *
 * Dedup: skips an image if an upscaled version for that index already exists
 * (checks original_image_id + is_upscaled).
 */
export async function upscaleRecordImages(
  _table: 'Generation' | 'Image Remix',
  generationId: string,
  imageIndex?: number,
): Promise<void> {
  const wavespeedKey = apiKeys.wavespeed;
  if (!wavespeedKey) {
    console.error('[upscale] No WaveSpeed API key configured');
    return;
  }

  try {
    // Fetch all non-upscaled (original) images for this generation
    const { data: originals, error: fetchErr } = await supabase
      .from('generation_images')
      .select('*')
      .eq('generation_id', generationId)
      .eq('is_upscaled', false)
      .order('sort_order', { ascending: true });

    if (fetchErr) throw new Error(`Failed to fetch images: ${fetchErr.message}`);
    if (!originals || originals.length === 0) {
      console.log(`[upscale] Generation ${generationId} has no images to upscale`);
      return;
    }

    const images = originals as GenerationImage[];

    // Determine which images to upscale
    const toUpscale = imageIndex !== undefined
      ? images.filter(img => img.sort_order === imageIndex)
      : images;

    if (toUpscale.length === 0) {
      console.log(`[upscale] No image found at index ${imageIndex} for ${generationId}`);
      return;
    }

    // Dedup: check which already have upscaled versions
    const sourceIds = toUpscale.map(img => img.id);
    const { data: existingUpscaled } = await supabase
      .from('generation_images')
      .select('original_image_id')
      .in('original_image_id', sourceIds)
      .eq('is_upscaled', true);

    const alreadyUpscaledIds = new Set(
      (existingUpscaled || []).map(r => r.original_image_id)
    );

    const remaining = toUpscale.filter(img => !alreadyUpscaledIds.has(img.id));

    if (remaining.length === 0) {
      console.log(`[upscale] Generation ${generationId}: all requested images already upscaled — skipping`);
      return;
    }

    console.log(`[upscale] Starting upscale for ${remaining.length} image(s) on generation/${generationId}`);

    let successCount = 0;
    for (const img of remaining) {
      try {
        if (!img.url) {
          console.error(`[upscale] Image ${img.id} has no URL — skipping`);
          continue;
        }

        const idx = img.sort_order ?? 0;
        const buffer = await upscaleImage(img.url, wavespeedKey);
        const storagePath = `${generationId}/upscaled_idx${idx}.png`;
        const publicUrl = await uploadFile('generated-images', storagePath, buffer, 'image/png');

        // Insert new generation_images row for the upscaled version
        const { error: insertErr } = await supabase
          .from('generation_images')
          .insert({
            generation_id: generationId,
            storage_path: storagePath,
            url: publicUrl,
            filename: `upscaled_idx${idx}.png`,
            is_upscaled: true,
            original_image_id: img.id,
            sort_order: idx,
          });

        if (insertErr) {
          console.error(`[upscale] Insert failed for index ${idx}:`, insertErr.message);
          continue;
        }

        successCount++;
        console.log(`[upscale] Uploaded index ${idx} for ${generationId}`);
      } catch (err) {
        console.error(`[upscale] Failed index ${img.sort_order} for ${generationId}:`, err);
      }
    }

    console.log(`[upscale] Completed generation/${generationId}: ${successCount}/${remaining.length} images upscaled`);
  } catch (err) {
    console.error(`[upscale] Fatal error for generation/${generationId}:`, err);
  }
}
