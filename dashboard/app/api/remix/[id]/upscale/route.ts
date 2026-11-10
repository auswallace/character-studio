import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/safe-url';
import { supabase, apiKeys } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';

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

/**
 * Fire-and-forget upscale for remix images.
 * Reads images from remix_images, upscales via WaveSpeed, uploads to Storage,
 * and inserts new remix_images rows with is_upscaled=true.
 */
async function upscaleRemixImages(
  remixId: string,
  imageIndex?: number,
): Promise<void> {
  const wavespeedKey = apiKeys.wavespeed;
  if (!wavespeedKey) {
    console.error('[upscale] No WaveSpeed API key configured');
    return;
  }

  try {
    // Get all images for this remix
    const { data: allImages, error: fetchError } = await supabase
      .from('remix_images')
      .select('id, url, filename, sort_order, is_upscaled, original_image_id')
      .eq('remix_id', remixId)
      .order('sort_order');

    if (fetchError) throw fetchError;
    if (!allImages || allImages.length === 0) {
      console.log(`[upscale] Remix ${remixId} has no images to upscale`);
      return;
    }

    // Separate regular images from already-upscaled ones
    const regularImages = allImages.filter(img => !img.is_upscaled);
    const existingUpscaled = allImages.filter(img => img.is_upscaled);

    // Build set of original image IDs that already have an upscaled version
    const alreadyUpscaledIds = new Set(
      existingUpscaled
        .map(img => img.original_image_id)
        .filter(Boolean)
    );

    // Determine which images to upscale
    const toUpscale = imageIndex !== undefined
      ? regularImages.filter(img => img.sort_order === imageIndex)
      : regularImages;

    // Filter out already-upscaled ones
    const remaining = toUpscale.filter(img => !alreadyUpscaledIds.has(img.id));

    if (remaining.length === 0) {
      console.log(`[upscale] Remix ${remixId}: all requested images already upscaled — skipping`);
      return;
    }

    console.log(`[upscale] Starting upscale for ${remaining.length} image(s) on remix/${remixId}`);

    let successCount = 0;
    for (const img of remaining) {
      try {
        const buffer = await upscaleImage(img.url, wavespeedKey);

        const sortOrder = img.sort_order ?? 0;
        const storagePath = `${remixId}/upscaled_idx${sortOrder}.png`;
        const publicUrl = await uploadFile('remix-images', storagePath, buffer, 'image/png');

        // Insert upscaled image row linked to the original
        const { error: insertError } = await supabase
          .from('remix_images')
          .insert({
            remix_id: remixId,
            storage_path: storagePath,
            url: publicUrl,
            filename: `upscaled_idx${sortOrder}.png`,
            size: buffer.length,
            mime_type: 'image/png',
            is_upscaled: true,
            original_image_id: img.id,
            sort_order: sortOrder,
          });

        if (insertError) {
          console.error(`[upscale] Insert failed for remix/${remixId} idx ${sortOrder}:`, insertError);
        } else {
          successCount++;
          console.log(`[upscale] Uploaded upscaled idx ${sortOrder} for remix/${remixId}`);
        }
      } catch (err) {
        console.error(`[upscale] Failed idx ${img.sort_order} for remix/${remixId}:`, err);
      }
    }

    console.log(`[upscale] Completed remix/${remixId}: ${successCount}/${remaining.length} images upscaled`);
  } catch (err) {
    console.error(`[upscale] Fatal error for remix/${remixId}:`, err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const imageIndex = typeof body.imageIndex === 'number' ? body.imageIndex : undefined;

    // Fire-and-forget — respond immediately, upscale runs in background
    upscaleRemixImages(id, imageIndex).catch(err =>
      console.error(`[upscale] Background upscale failed for remix/${id}:`, err)
    );

    return NextResponse.json({ success: true, message: 'Upscale started' });
  } catch (err) {
    console.error(`[upscale] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
