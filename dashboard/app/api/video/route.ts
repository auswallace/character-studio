import { NextRequest, NextResponse } from 'next/server';
import { assertSpendAllowed, SpendCapError, SimulateModeError } from '@/lib/spend-guard';
import { videoCost } from '@/lib/pricing';
import { safeFetch } from '@/lib/safe-url';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { extractFirstFrame, muxAudioFrom } from '@/lib/video-thumbnail';
import {
  KlingVideoProvider,
  SeedanceVideoProvider,
  VeoVideoProvider,
  GeminiOmniVideoProvider,
  WanVideoProvider,
  WanAnimateProvider,
  VIDEO_MODELS,
  type VideoGenerationRequest,
  type VideoProvider,
} from '@/lib/video-providers';

// ─── Types ────────────────────────────────────────────────

interface VideoRequestBody {
  loras?: { path: string; scale?: number }[];
  highNoiseLoras?: { path: string; scale?: number }[];
  lowNoiseLoras?: { path: string; scale?: number }[];
  model: string;
  prompt: string;
  negativePrompt?: string;
  sourceImageUrl?: string;
  endImageUrl?: string;
  referenceVideoUrl?: string;
  characterOrientation?: 'image' | 'video';
  keepOriginalSound?: boolean;
  animateMode?: 'animate' | 'replace';
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
  cameraFixed?: boolean;
  cfgScale?: number;
  seed?: number;
  personaId?: string;
}

// ─── Helpers ──────────────────────────────────────────────

function sseEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  data: Record<string, unknown>,
) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function keepAlive(controller: ReadableStreamDefaultController) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`:keepalive\n\n`));
}

async function getNextVideoName(personaName: string | null): Promise<string> {
  const prefix = personaName ? personaName.split(' ')[0].toLowerCase() : 'video';
  const { count } = await supabase
    .from('video_generations')
    .select('*', { count: 'exact', head: true })
    .ilike('name', `${prefix}_video_%`);
  const num = (count || 0) + 1;
  return `${prefix}_video_${String(num).padStart(4, '0')}`;
}

function getProvider(model: string): VideoProvider {
  switch (model) {
    case VIDEO_MODELS.KLING_V3:
    case VIDEO_MODELS.KLING_O3:
    case VIDEO_MODELS.KLING_MOTION:
      return new KlingVideoProvider();
    case VIDEO_MODELS.SEEDANCE_1_5:
    case VIDEO_MODELS.SEEDANCE_2_0:
    case VIDEO_MODELS.SEEDANCE_2_5:
      return new SeedanceVideoProvider();
    case VIDEO_MODELS.VEO_3_1:
      return new VeoVideoProvider();
    case VIDEO_MODELS.GEMINI_OMNI_FLASH:
      return new GeminiOmniVideoProvider();
    case VIDEO_MODELS.WAN_2_2:
      return new WanVideoProvider();
    case VIDEO_MODELS.WAN_ANIMATE:
      return new WanAnimateProvider();
    default:
      throw new Error(`Unknown video model: ${model}`);
  }
}

function getVideoMode(model: string): string {
  return model === VIDEO_MODELS.KLING_MOTION || model === VIDEO_MODELS.WAN_ANIMATE ? 'motion_control' : 'image_to_video';
}

// ─── POST — Generate Video (SSE Stream) ──────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let recordId: string | null = null;

  try {
    const body: VideoRequestBody = await request.json();
    const { model, prompt, personaId } = body;

    // Daily spend cap (lib/spend-guard.ts). Refuse before any provider call.
    try { await assertSpendAllowed(); } catch (e) {
      if (e instanceof SpendCapError) return NextResponse.json({ error: e.message }, { status: 429 });
      if (e instanceof SimulateModeError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }

    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }
    if (!prompt && model !== VIDEO_MODELS.KLING_MOTION && model !== VIDEO_MODELS.WAN_ANIMATE) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }
    if ((model === VIDEO_MODELS.KLING_MOTION || model === VIDEO_MODELS.WAN_ANIMATE) && !body.referenceVideoUrl) {
      return NextResponse.json({ error: 'referenceVideoUrl is required for motion control' }, { status: 400 });
    }

    // Look up persona name for auto-naming
    let personaName: string | null = null;
    if (personaId) {
      const { data: persona } = await supabase
        .from('personas')
        .select('name')
        .eq('id', personaId)
        .single();
      personaName = persona?.name || null;
    }

    const autoName = await getNextVideoName(personaName);
    const videoMode = getVideoMode(model);

    // Source images/videos should already be uploaded via /api/video/upload
    // and arrive here as public URLs (not base64).
    const sourceImageUrl = body.sourceImageUrl || null;
    const endImageUrl = body.endImageUrl || null;
    const referenceVideoUrl = body.referenceVideoUrl || null;

    // Create Supabase record
    const { data: record, error: insertError } = await supabase
      .from('video_generations')
      .insert({
        persona_id: personaId || null,
        video_model: model,
        video_mode: videoMode,
        prompt: prompt || null,
        negative_prompt: body.negativePrompt || null,
        source_image_url: sourceImageUrl,
        end_image_url: endImageUrl,
        reference_video_url: referenceVideoUrl,
        duration: body.duration || 5,
        aspect_ratio: body.aspectRatio || '16:9',
        resolution: body.resolution || '1080p',
        generate_audio: body.generateAudio ?? false,
        model_params: {
          cfgScale: body.cfgScale,
          cameraFixed: body.cameraFixed,
          characterOrientation: body.characterOrientation,
          keepOriginalSound: body.keepOriginalSound,
          seed: body.seed,
          loras: body.loras, highNoiseLoras: body.highNoiseLoras, lowNoiseLoras: body.lowNoiseLoras,
        },
        status: 'generating',
        name: autoName,
      })
      .select()
      .single();

    if (insertError || !record) {
      return NextResponse.json({ error: insertError?.message || 'Failed to create record' }, { status: 500 });
    }

    recordId = record.id;
    console.log(`[video] Created record ${recordId} — ${autoName} (${model})`);

    const provider = getProvider(model);

    const videoRequest: VideoGenerationRequest = {
      prompt: prompt || '',
      negativePrompt: body.negativePrompt,
      sourceImageUrl: sourceImageUrl || undefined,
      endImageUrl: endImageUrl || undefined,
      referenceVideoUrl: referenceVideoUrl || undefined,
      characterOrientation: body.characterOrientation,
      keepOriginalSound: body.keepOriginalSound,
      animateMode: body.animateMode,
      duration: body.duration || 5,
      aspectRatio: body.aspectRatio || '16:9',
      resolution: body.resolution || '1080p',
      generateAudio: body.generateAudio ?? false,
      cameraFixed: body.cameraFixed ?? false,
      cfgScale: body.cfgScale,
      seed: body.seed,
      loras: Array.isArray(body.loras) ? body.loras : undefined,
      highNoiseLoras: Array.isArray(body.highNoiseLoras) ? body.highNoiseLoras : undefined,
      lowNoiseLoras: Array.isArray(body.lowNoiseLoras) ? body.lowNoiseLoras : undefined,
    };

    // ─── SSE Stream ─────────────────────────────────────────

    const stream = new ReadableStream({
      async start(controller) {
        const rid = recordId!;

        // Keepalive interval — video gen takes 30s-5min
        const keepAliveInterval = setInterval(() => {
          try { keepAlive(controller); } catch { /* client disconnected */ }
        }, 15000);

        try {
          sseEvent(controller, 'progress', { stage: 'Starting video generation...', recordId: rid, name: autoName });

          const result = await provider.generate(model, videoRequest, {
            onProgress: (stage) => {
              try { sseEvent(controller, 'progress', { stage }); }
              catch { /* client disconnected */ }
            },
            onRequestId: async (reqId, prov) => {
              // Save request ID immediately so recovery can find it
              try {
                await supabase.from('video_generations').update({
                  provider_request_id: reqId,
                  provider: prov,
                }).eq('id', rid);
                console.log(`[video] Saved provider request ID: ${prov}/${reqId}`);
              } catch { /* best effort */ }
            },
          });

          // Update provider on record
          try {
            await supabase.from('video_generations').update({ provider: result.provider }).eq('id', rid);
          } catch { /* best effort */ }

          // Download from provider and persist in Supabase Storage —
          // fal.ai/Wavespeed URLs expire after days/weeks, so this MUST succeed.
          // Failures bubble to the outer SSE catch which marks status='error'.
          let thumbnailUrl: string | null = null;
          let thumbnailStoragePath: string | null = null;

          try { sseEvent(controller, 'progress', { stage: 'Downloading video...' }); }
          catch { /* client disconnected */ }

          const resp = await safeFetch(result.videoUrl, { purpose: 'video output', trustedProviderUrl: true });
          if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching provider video`);
          let buffer: Buffer = Buffer.from(await resp.arrayBuffer());
          // Wan Animate is silent. With "Sound On", put the motion video's sound track back on the clip.
          if (model === VIDEO_MODELS.WAN_ANIMATE && body.keepOriginalSound && referenceVideoUrl) {
            try {
              sseEvent(controller, 'progress', { stage: 'Adding the original sound...' });
              const src = await safeFetch(referenceVideoUrl, { purpose: 'motion video audio', trustedProviderUrl: true });
              const withSound = src.ok ? await muxAudioFrom(buffer, Buffer.from(await src.arrayBuffer())) : null;
              if (withSound) { buffer = withSound; result.hasAudio = true; }
            } catch (muxErr) { console.error('[video] audio mux failed, saving silent clip:', muxErr instanceof Error ? muxErr.message : muxErr); }
          }
          const fileSize = buffer.length;

          try { sseEvent(controller, 'progress', { stage: `Saving video (${(fileSize / 1024 / 1024).toFixed(1)} MB)...` }); }
          catch { /* client disconnected */ }

          const storagePath = `generated/${rid}/video.mp4`;
          const videoUrl = await uploadFile('video-pipeline', storagePath, buffer, 'video/mp4');
          console.log(`[video] Uploaded ${storagePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

          // Extract thumbnail (best effort — failures don't block the pipeline,
          // because the video itself is already safely persisted)
          try {
            const thumbBuffer = await extractFirstFrame(buffer);
            thumbnailStoragePath = `generated/${rid}/thumb.jpg`;
            thumbnailUrl = await uploadFile('video-pipeline', thumbnailStoragePath, thumbBuffer, 'image/jpeg');
            console.log(`[video] Thumbnail uploaded ${thumbnailStoragePath} (${(thumbBuffer.length / 1024).toFixed(1)} KB)`);
          } catch (thumbErr) {
            const msg = thumbErr instanceof Error ? thumbErr.message : String(thumbErr);
            console.error(`[video] Thumbnail extraction failed: ${msg}`);
            thumbnailStoragePath = null;
            thumbnailUrl = null;
          }

          // The recover route can race this save (Video tab reloaded mid-job) and insert a row that points at the
          // provider's temporary URL with no thumbnail. This row is the durable one: remove any earlier row first.
          try { await supabase.from('video_outputs').delete().eq('video_generation_id', rid); } catch { /* best effort */ }
          await supabase.from('video_outputs').insert({
            video_generation_id: rid,
            url: videoUrl,
            storage_path: storagePath,
            thumbnail_url: thumbnailUrl,
            thumbnail_storage_path: thumbnailStoragePath,
            filename: 'video.mp4',
            duration_seconds: result.durationSeconds,
            file_size: fileSize,
            mime_type: 'video/mp4',
            has_audio: result.hasAudio,
            provider_request_id: result.requestId,
            submitted_at: result.submittedAt,
            completed_at: result.completedAt,
          });

          // Update generation status
          const elapsedNum = (Date.now() - startTime) / 1000;
          const elapsed = elapsedNum.toFixed(1);

          await supabase.from('video_generations').update({
            status: 'done',
            provider_request_id: result.requestId,
          }).eq('id', rid);
          if (result.providerInput) { try { await supabase.from('video_generations').update({ provider_input: result.providerInput }).eq('id', rid); } catch { /* best effort */ } }

          // Cost + timing (best effort: columns from 20261104_cost_columns.sql may not exist yet)
          try {
            const est = videoCost(model, result.durationSeconds || body.duration || 5, result.hasAudio);
            await supabase.from('video_generations').update({
              cost_usd: est.costUsd, cost_source: est.source, inference_ms: Math.round(elapsedNum * 1000),
            }).eq('id', rid);
          } catch { /* best effort */ }

          console.log(`[video] Done! ${autoName}: 1 video in ${elapsed}s`);

          // Send video event then done
          try {
            sseEvent(controller, 'video', { url: videoUrl, hasAudio: result.hasAudio });
            sseEvent(controller, 'done', {
              success: true,
              recordId: rid,
              name: autoName,
              imageCount: 1,
              failedCount: 0,
              elapsed: `${elapsed}s`,
            });
          } catch { /* client disconnected — video already saved */ }

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[video] SSE stream error:', errMsg);

          try {
            await supabase.from('video_generations').update({
              status: 'error',
              error_details: errMsg,
            }).eq('id', rid);
          } catch { /* best effort */ }

          try { sseEvent(controller, 'error', { message: `Video generation failed: ${errMsg}`, fatal: true }); }
          catch { /* client disconnected */ }
        } finally {
          clearInterval(keepAliveInterval);
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
    console.error('[video] Error:', errMsg);

    if (recordId) {
      try {
        await supabase.from('video_generations').update({
          status: 'error',
          error_details: errMsg,
        }).eq('id', recordId);
      } catch { /* best effort */ }
    }

    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// ─── GET — List Video Generations ─────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ids = searchParams.get('ids');
    const recovery = searchParams.get('recovery') === 'true';
    const persona = searchParams.get('persona');
    const starred = searchParams.get('starred');
    const model = searchParams.get('model');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = supabase
      .from('video_generations')
      .select('*, video_outputs(*)')
      .order('created_at', { ascending: false });

    // Recovery mode — fetch specific IDs
    if (ids && recovery) {
      const idList = ids.split(',').filter(Boolean);
      query = supabase
        .from('video_generations')
        .select('*, video_outputs(*)')
        .in('id', idList);

      const { data, error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const videos = (data || []).map(mapVideoRecord);
      return NextResponse.json({ videos });
    }

    if (persona) query = query.eq('persona_id', persona);
    if (starred === 'true') query = query.eq('starred', true);
    if (model) query = query.eq('video_model', model);

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const videos = (data || []).map(mapVideoRecord);
    return NextResponse.json({ videos });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[video] GET error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// ─── Record mapper ────────────────────────────────────────

function mapVideoRecord(row: Record<string, unknown>) {
  // Stored copies (storage_path set, thumbnail present) first: outputs[0] is what every card shows.
  const outputs = [...((row.video_outputs as Record<string, unknown>[]) || [])].sort((a, b) => Number(!!b.storage_path) - Number(!!a.storage_path));
  return {
    id: row.id,
    name: row.name,
    personaId: row.persona_id,
    videoModel: row.video_model,
    videoMode: row.video_mode,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    sourceImageUrl: row.source_image_url,
    endImageUrl: row.end_image_url,
    referenceVideoUrl: row.reference_video_url,
    duration: row.duration,
    aspectRatio: row.aspect_ratio,
    resolution: row.resolution,
    generateAudio: row.generate_audio,
    modelParams: row.model_params,
    status: row.status,
    errorDetails: row.error_details,
    provider: row.provider,
    starred: row.starred,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
    outputs: outputs.map(o => ({
      id: o.id,
      url: o.url,
      storagePath: o.storage_path,
      thumbnailUrl: o.thumbnail_url,
      thumbnailStoragePath: o.thumbnail_storage_path,
      filename: o.filename,
      durationSeconds: o.duration_seconds,
      width: o.width,
      height: o.height,
      fileSize: o.file_size,
      hasAudio: o.has_audio,
      createdAt: o.created_at,
    })),
  };
}
