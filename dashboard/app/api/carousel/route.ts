import { NextRequest, NextResponse } from 'next/server';
import { assertSpendAllowed, SpendCapError } from '@/lib/spend-guard';
import { scoreRecordInBackground } from '@/lib/scorer';
import { supabase, apiKeys, GROK_TEXT_MODEL } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { stripImageMetadata } from '@/lib/strip-metadata';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/prompt-templates';
import { getProviderRouter, MODEL_NAMES, WavespeedGenerationResult, aspectRatioToSize, calculateAspectRatio } from '@/lib/providers';

// ─── Helpers ──────────────────────────────────────────────

/** Write an SSE event to a stream controller */
function sseEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  data: Record<string, unknown>,
) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

/** Get the next auto-incremented carousel name (e.g., sofi_carousel_0003) */
async function getNextCarouselName(personaName: string): Promise<string> {
  const prefix = personaName.split(' ')[0].toLowerCase(); // "Sofi Belle" → "sofi"
  const carouselPrefix = `${prefix}_carousel`;

  const { data: records } = await supabase
    .from('carousels')
    .select('name')
    .ilike('name', `${carouselPrefix}_%`);

  const regex = new RegExp(`^${carouselPrefix}_(\\d+)`, 'i');
  let maxNum = 0;
  for (const r of (records || [])) {
    const name = r.name || '';
    const match = name.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `${carouselPrefix}_${String(maxNum + 1).padStart(4, '0')}`;
}

/**
 * Merge user notes into a carousel angle prompt via Grok.
 * Returns the enhanced prompt. If Grok fails, falls back to appending notes.
 */
async function mergePromptWithNotes(carouselPrompt: string, userNotes: string): Promise<string> {
  const grokKey = apiKeys.grok;
  if (!grokKey) {
    console.warn('[carousel] Grok API key not configured — appending notes directly');
    return `${carouselPrompt}\n\nAdditional context: ${userNotes}`;
  }

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grokKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a prompt engineer for an AI image carousel generator. The user\'s notes describe ONLY pose, facial expression, body language, and camera framing adjustments. The outfit, clothing, environment, lighting, setting, and overall scene atmosphere must remain EXACTLY as described in the carousel prompt — do NOT change them based on user notes. Merge the user\'s pose/expression notes into the carousel prompt naturally while keeping ALL camera angle and perspective instructions intact. Output ONLY the final merged prompt, nothing else.',
          },
          {
            role: 'user',
            content: `CAROUSEL PROMPT:\n${carouselPrompt}\n\nUSER NOTES:\n${userNotes}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[carousel] Grok merge failed (${res.status}): ${errText} — appending notes directly`);
      return `${carouselPrompt}\n\nAdditional context: ${userNotes}`;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      console.warn('[carousel] Grok returned no content — appending notes directly');
      return `${carouselPrompt}\n\nAdditional context: ${userNotes}`;
    }

    console.log(`[carousel] Grok enhanced prompt (${text.trim().length} chars): "${text.trim().substring(0, 120)}..."`);
    return text.trim();
  } catch (err) {
    console.warn(`[carousel] Grok merge error: ${err instanceof Error ? err.message : err} — appending notes directly`);
    return `${carouselPrompt}\n\nAdditional context: ${userNotes}`;
  }
}

/** Build Next.js image optimization thumbnails for a Supabase Storage URL */
function makeThumbnails(url: string) {
  if (!url) return null;
  const enc = encodeURIComponent(url);
  return {
    small: { url: `/_next/image?url=${enc}&w=64&q=70` },
    large: { url: `/_next/image?url=${enc}&w=640&q=75` },
    full: { url: `/_next/image?url=${enc}&w=1920&q=85` },
  };
}

// ─── Model sizes ─────────────────────────────────────────

const MODEL_DEFAULT_SIZES: Record<string, string> = {
  'Seedream 5.0 Lite': '1440x2560',
  'Seedream 4.5': '1440x2560',
  'Seedream 4.0': '1440x2560',
  'Nanobanana Pro': '1440x2560',
  'Nanobanana 2': '1440x2560',
  'Nanobanana 2.1': '1440x2560',
};

// ─── Default Carousel Prompts ────────────────────────────
// Fallbacks used when prompt_templates DB has no entry for a key.

const CAROUSEL_DEFAULTS: Record<string, string> = {
  'carousel:angle_left': 'Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but shift the camera position approximately 30 degrees to the left of the original viewpoint. Keep the same distance from the subject and the same framing. The person\'s pose should adjust naturally to the new camera angle as it would in a real photo taken seconds apart. Maintain natural skin texture, the same ambient lighting direction, and all background elements. Candid snapshot, same moment different angle',
  'carousel:closeup': 'Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but move the camera closer to the subject for a medium close-up framing from chest up, positioned slightly above eye level looking down at a subtle angle. The subject should appear to glance up naturally toward the camera. Keep the same background visible but now with shallow depth of field softly blurring it. Maintain all environmental details, same ambient light source and direction. Shot on iPhone 15 Pro, casual portrait moment',
  'carousel:wide': 'Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but pull the camera back to a wider full-body environmental shot, showing more of the surrounding space. The subject should appear naturally within the broader scene at roughly the same position. Reveal more of the floor, ceiling or sky, and background context that would logically exist beyond the original frame. Keep the same lighting conditions and atmosphere. Slight wide-angle perspective as if taken on a smartphone rear camera stepped back a few meters',
  'carousel:over_shoulder': 'Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but reposition the camera approximately 120 degrees around the subject to capture a three-quarter rear view. The person is glancing back over their shoulder toward where the original camera was, with a natural relaxed expression. Show the back of their outfit and hair while keeping their face partially visible in profile. The same environment and lighting should be visible from this new perspective. Candid over-the-shoulder moment',
};

// Map TEMPLATE_KEYS constants to their string key values for lookup
const TEMPLATE_KEY_MAP: Record<string, string> = {
  [TEMPLATE_KEYS.CAROUSEL_ANGLE_LEFT]: 'carousel:angle_left',
  [TEMPLATE_KEYS.CAROUSEL_CLOSEUP]: 'carousel:closeup',
  [TEMPLATE_KEYS.CAROUSEL_WIDE]: 'carousel:wide',
  [TEMPLATE_KEYS.CAROUSEL_OVER_SHOULDER]: 'carousel:over_shoulder',
};

// ─── GET: List carousels ─────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const persona = searchParams.get('persona');
    const ids = searchParams.get('ids');
    const setId = searchParams.get('set_id');

    let query = supabase
      .from('carousels')
      .select('*, carousel_images(*)')
      .order('created_at', { ascending: false });

    // Recovery mode: fetch specific records by ID
    if (ids) {
      const idList = ids.split(',').filter(Boolean);
      query = query.in('id', idList);
    } else {
      query = query.limit(limit);
      if (persona) {
        query = query.eq('persona', persona);
      }
      if (setId) {
        query = query.eq('carousel_set_id', setId);
      }
    }

    const { data: records, error } = await query;
    if (error) throw error;

    const carousels = (records || []).map(r => {
      const allImages = (r.carousel_images || []) as Array<{
        url: string;
        filename: string;
        width: number | null;
        height: number | null;
        is_upscaled: boolean;
        sort_order: number | null;
      }>;

      const regularImages = allImages
        .filter(img => !img.is_upscaled)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      const upscaledImages = allImages
        .filter(img => img.is_upscaled)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      return {
        id: r.id,
        name: r.name || '',
        persona: r.persona || '',
        imageModel: r.image_model || '',
        carouselSetId: r.carousel_set_id || null,
        promptTemplateKey: r.prompt_template_key || '',
        prompt: r.prompt || '',
        sourceImageUrl: r.source_image_url || null,
        variants: regularImages.map(img => ({
          url: img.url,
          filename: img.filename,
          width: img.width,
          height: img.height,
          thumbnails: makeThumbnails(img.url),
        })),
        upscaledImages: upscaledImages.map(img => ({
          url: img.url,
          filename: img.filename,
          width: img.width,
          height: img.height,
          thumbnails: makeThumbnails(img.url),
        })),
        status: r.error_message
          ? 'error'
          : regularImages.length > 0
            ? 'done'
            : 'pending',
        error: r.error_message || null,
        starred: r.starred || false,
        provider: r.provider || null,
        providerInput: r.provider_input || null,
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({ carousels });
  } catch (error) {
    console.error('[api/carousel] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch carousels' },
      { status: 500 }
    );
  }
}

// ─── POST: Create carousel record AND generate 1 image ───

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let recordId: string | undefined; // Hoisted so outer catch can write errors to Supabase

  try {
    // Daily spend cap (lib/spend-guard.ts). Runs before any prompt or provider logic; touches nothing else here.
    try { await assertSpendAllowed({ simulable: true }); } catch (e) {
      if (e instanceof SpendCapError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
    const body = await request.json();
    const {
      sourceImageUrl,
      promptTemplateKey,
      carouselSetId,
      persona,
      personaId,
      imageModel,
    } = body;

    const userNotes = (body.notes as string | undefined)?.trim() || '';
    const uiResolution = body.resolution as string | undefined;
    const uiParams = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>;
    const uiAspectRatio = body.aspectRatio as string | undefined;

    // Validate required fields
    if (!sourceImageUrl) {
      return NextResponse.json(
        { error: 'sourceImageUrl is required' },
        { status: 400 }
      );
    }
    if (!promptTemplateKey) {
      return NextResponse.json(
        { error: 'promptTemplateKey is required' },
        { status: 400 }
      );
    }
    if (!carouselSetId) {
      return NextResponse.json(
        { error: 'carouselSetId is required' },
        { status: 400 }
      );
    }
    if (!persona || !personaId) {
      return NextResponse.json(
        { error: 'persona and personaId are required' },
        { status: 400 }
      );
    }
    if (!imageModel) {
      return NextResponse.json(
        { error: 'imageModel is required' },
        { status: 400 }
      );
    }

    // Normalize model ID → display name
    const rawModel = imageModel;
    const model = MODEL_NAMES[rawModel] || rawModel;
    const size = uiAspectRatio ? aspectRatioToSize(uiAspectRatio) : (MODEL_DEFAULT_SIZES[model] || '1440x2560');

    console.log(`[carousel] Starting: ${model}, key=${promptTemplateKey}, set=${carouselSetId}, persona=${persona}`);

    // Step 1: Fetch prompt template + enhance with notes if provided
    const fallback = CAROUSEL_DEFAULTS[promptTemplateKey] || 'Generate a professional photo variation of the source image.';
    let prompt = await getTemplate(promptTemplateKey, fallback);
    console.log(`[carousel] Base prompt resolved (${prompt.length} chars): "${prompt.substring(0, 100)}..."`);

    if (userNotes) {
      console.log(`[carousel] Enhancing prompt with user notes: "${userNotes.substring(0, 80)}..."`);
      prompt = await mergePromptWithNotes(prompt, userNotes);
      console.log(`[carousel] Enhanced prompt (${prompt.length} chars): "${prompt.substring(0, 120)}..."`);
    }

    // Step 2: Auto-name and create Supabase record
    const autoName = await getNextCarouselName(persona);
    const isDataUri = sourceImageUrl.startsWith('data:');

    const insertData: Record<string, unknown> = {
      name: autoName,
      persona: persona,
      persona_id: personaId,
      image_model: model,
      carousel_set_id: carouselSetId,
      prompt_template_key: promptTemplateKey,
      prompt: prompt,
      notes: userNotes || null,
    };

    // If source is a real URL (not data URI), save it directly
    if (!isDataUri) {
      insertData.source_image_url = sourceImageUrl;
    }

    const { data: record, error: createError } = await supabase
      .from('carousels')
      .insert(insertData)
      .select()
      .single();

    if (createError) throw createError;
    recordId = record.id;
    const recordName = record.name || autoName;
    console.log(`[carousel] Created record ${recordName} (${recordId})`);

    // Step 3: If source image is a data URI, upload to Storage
    let resolvedSourceUrl = sourceImageUrl;
    if (isDataUri) {
      try {
        const base64Data = sourceImageUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`[carousel] Uploading source image to Storage (${(buffer.length / 1024).toFixed(0)} KB)...`);
        const sourcePath = `${recordId}/source.jpg`;
        const sourcePublicUrl = await uploadFile('carousel-images', sourcePath, buffer);
        resolvedSourceUrl = sourcePublicUrl;

        await supabase
          .from('carousels')
          .update({ source_image_url: sourcePublicUrl })
          .eq('id', recordId);

        console.log(`[carousel] Source image uploaded`);
      } catch (err) {
        console.warn(`[carousel] Source image upload failed: ${err instanceof Error ? err.message : err}`);
        // Continue — Wavespeed accepts data URIs
      }
    }

    // Step 4: Build reference images — source image ONLY (no face refs)
    // Carousel prompts reference "Image 1" as the foundational reference.
    // Unlike remix, we don't send persona face/body refs — just the source image.
    const router = getProviderRouter();
    const validRefs = [resolvedSourceUrl].filter(Boolean);
    console.log(`[carousel] Reference images: ${validRefs.length} (source image only)`);

    // Step 5: Generate 1 image via SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const rid = recordId!;
        try {
          sseEvent(controller, 'progress', { stage: 'Starting carousel image generation...', recordId: rid, name: recordName });

          const allImageUrls: { url: string; index: number }[] = [];

          const result = await router.generate(model, {
            prompt: prompt,
            images: validRefs,
            numImages: 1,
            imageSize: size,
            aspectRatio: uiAspectRatio || calculateAspectRatio(size),
            resolution: uiResolution || '2k',
            params: uiParams,
          }, (url, index) => {
            allImageUrls.push({ url, index });
            try { sseEvent(controller, 'image', { index, url, total: 1 }); }
            catch { /* client disconnected */ }
          }, (stage) => {
            try { sseEvent(controller, 'progress', { stage }); }
            catch { /* client disconnected */ }
          });

          // Save which provider was used
          try { await supabase.from('carousels').update({ provider: result.provider }).eq('id', rid); } catch { /* best effort */ }

          // Post-process: strip metadata + save to Supabase
          try { sseEvent(controller, 'progress', { stage: 'Saving image...' }); }
          catch { /* client disconnected */ }

          const wsResult = result as WavespeedGenerationResult;
          const perImageResults = wsResult.perImageResults;

          console.log(`[carousel] Stripping metadata from ${allImageUrls.length} images...`);
          await Promise.allSettled(allImageUrls.map(async ({ url: imgUrl, index: i }) => {
            try {
              const cleanBuffer = await stripImageMetadata(imgUrl);
              console.log(`[carousel] Image ${i + 1}/${allImageUrls.length} metadata stripped (${(cleanBuffer.length / 1024).toFixed(0)} KB)`);
              const storagePath = `${rid}/image_${i + 1}.jpg`;
              const publicUrl = await uploadFile('carousel-images', storagePath, cleanBuffer);

              const imgMeta = perImageResults?.[i];

              await supabase.from('carousel_images').insert({
                carousel_id: rid,
                storage_path: storagePath,
                url: publicUrl,
                filename: `carousel_${i + 1}.jpg`,
                size: cleanBuffer.length,
                mime_type: 'image/jpeg',
                sort_order: i,
                wavespeed_request_id: imgMeta?.wavespeedRequestId || result.requestId,
                submitted_at: imgMeta?.submittedAt || result.submittedAt,
                completed_at: imgMeta?.completedAt || result.completedAt,
              });
            } catch (uploadErr) {
              console.error(`[carousel] Failed to strip/upload image ${i + 1}, falling back to URL:`, uploadErr);
              await supabase.from('carousel_images').insert({
                carousel_id: rid,
                url: imgUrl,
                filename: `carousel_${i + 1}.jpg`,
                sort_order: i,
                wavespeed_request_id: result.requestId,
                submitted_at: result.submittedAt,
                completed_at: result.completedAt,
              });
            }
          }));

          const imageCount = allImageUrls.length;

          if (imageCount === 0) {
            await supabase.from('carousels').update({
              error_message: 'Image generation failed — no images returned',
            }).eq('id', rid);
          }

          const elapsedNum = (Date.now() - startTime) / 1000;
          const elapsed = elapsedNum.toFixed(1);
          console.log(`[carousel] Done! ${recordName}: ${imageCount} image(s) in ${elapsed}s`);

          // Persist duration
          try { await supabase.from('carousels').update({ duration_seconds: elapsedNum }).eq('id', rid); } catch { /* best effort */ }
          // Face-consistency score (scripts/scorer). Fire-and-forget; no-op without SCORER_URL.
          if (imageCount > 0) scoreRecordInBackground('carousel', rid);

          try {
            sseEvent(controller, 'done', {
              success: imageCount > 0,
              recordId: rid,
              name: recordName,
              imageCount,
              requestedCount: 1,
              failedCount: 1 - imageCount,
              elapsed: `${elapsed}s`,
            });
          } catch { /* client disconnected — images already saved to Supabase */ }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[carousel] SSE stream error:', errMsg);
          try { sseEvent(controller, 'error', { message: `Image generation failed: ${errMsg}`, fatal: true }); }
          catch { /* client disconnected */ }
          try {
            await supabase.from('carousels').update({ error_message: `Image generation failed: ${errMsg}`, duration_seconds: (Date.now() - startTime) / 1000 }).eq('id', rid);
          } catch { /* best effort */ }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[carousel] Unhandled error:', errMsg);
    // Write error to Supabase so the record doesn't appear stuck forever
    if (recordId) {
      try {
        await supabase
          .from('carousels')
          .update({ error_message: `Unhandled error: ${errMsg}` })
          .eq('id', recordId);
      } catch { /* best effort — don't mask the original error */ }
    }
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
