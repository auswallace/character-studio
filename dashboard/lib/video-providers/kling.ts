// dashboard/lib/video-providers/kling.ts
//
// Kling video provider — handles both:
//   - Kling v3.0 Pro Image-to-Video (fal.ai primary, Wavespeed fallback)
//   - Kling 2.6 Pro Motion Control (fal.ai primary, Wavespeed fallback)
//
// Both use async queue pattern: submit → poll → result.

import {
  VideoProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
  VIDEO_MODELS,
  VIDEO_MODEL_NAMES,
  type VideoModelId,
} from './types';
import { apiKeys } from '@/lib/supabase';
import { runWavespeedJob } from '@/lib/wavespeed-poll';

// ─── Constants ────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const FAL_BASE = 'https://queue.fal.run';
const FAL_RESULT_BASE = 'https://queue.fal.run';

const FAL_ENDPOINTS: Record<string, string> = {
  [VIDEO_MODELS.KLING_V3]: 'fal-ai/kling-video/v3/pro/image-to-video',
  [VIDEO_MODELS.KLING_MOTION]: 'fal-ai/kling-video/v2.6/pro/motion-control',
};

const WAVESPEED_ENDPOINTS: Record<string, string> = {
  [VIDEO_MODELS.KLING_V3]: 'https://api.wavespeed.ai/api/v3/kwaivgi/kling-v3.0-pro/image-to-video',
  [VIDEO_MODELS.KLING_MOTION]: 'https://api.wavespeed.ai/api/v3/kwaivgi/kling-v2.6-pro/motion-control',
  // Kling O3 (Omni) Pro: native audio, 3-15s, $0.112/s (+25% with sound). Wavespeed only.
  [VIDEO_MODELS.KLING_O3]: 'https://api.wavespeed.ai/api/v3/kwaivgi/kling-video-o3-pro/image-to-video',
};


const POLL_INTERVAL = 5000;      // 5s between polls
const MAX_POLL_ATTEMPTS = 120;   // ~10 min total (video gen is slow)

// ─── Provider ─────────────────────────────────────────────

export class KlingVideoProvider implements VideoProvider {
  readonly name = 'kling';
  readonly supportedModels = [VIDEO_MODELS.KLING_V3, VIDEO_MODELS.KLING_O3, VIDEO_MODELS.KLING_MOTION];

  async generate(
    model: string,
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    // Try fal.ai first, fall back to Wavespeed
    const cbs = callbacks as { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void };
    // O3 has no fal endpoint wired yet; go straight to Wavespeed.
    if (model === VIDEO_MODELS.KLING_O3) {
      return await this.generateViaWavespeed(model, request, cbs);
    }
    try {
      return await this.generateViaFal(model, request, cbs);
    } catch (falError) {
      const falMsg = falError instanceof Error ? falError.message : String(falError);
      console.warn(`[kling] fal.ai failed: ${falMsg}, trying Wavespeed fallback...`);
      cbs.onProgress?.('fal.ai failed, trying Wavespeed...');
      return await this.generateViaWavespeed(model, request, cbs);
    }
  }

  // ─── fal.ai (async queue) ───────────────────────────────

  private async generateViaFal(
    model: string,
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    const falKey = apiKeys.fal;
    if (!falKey) throw new Error('fal.ai API key not configured');

    const endpoint = FAL_ENDPOINTS[model];
    if (!endpoint) throw new Error(`Kling: unsupported model "${model}"`);

    const submittedAt = new Date().toISOString();
    const body = this.buildFalBody(model, request);

    console.log(`[kling] Submitting ${model} to fal.ai queue...`);
    callbacks.onProgress?.(`Submitting to fal.ai (${model})...`);

    // Submit to queue
    const submitRes = await fetch(`${FAL_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`fal.ai submit error ${submitRes.status}: ${errText.substring(0, 300)}`);
    }

    const { request_id } = await submitRes.json();
    if (!request_id) throw new Error('fal.ai: no request_id returned');

    console.log(`[kling] fal.ai request_id: ${request_id}`);
    callbacks.onRequestId?.(request_id, 'fal');
    callbacks.onProgress?.('Queued, waiting for generation...');

    // Poll for result
    for (let poll = 0; poll < MAX_POLL_ATTEMPTS; poll++) {
      await sleep(POLL_INTERVAL);

      const statusRes = await fetch(
        `${FAL_RESULT_BASE}/${endpoint}/requests/${request_id}/status`,
        { headers: { Authorization: `Key ${falKey}` } },
      );

      if (!statusRes.ok) {
        console.warn(`[kling] fal.ai status poll ${poll + 1} failed: HTTP ${statusRes.status}`);
        continue;
      }
      const status = await statusRes.json();
      console.log(`[kling] fal.ai poll ${poll + 1}: status=${status.status}`);

      if (status.status === 'COMPLETED') {
        // Fetch the actual result
        const resultRes = await fetch(
          `${FAL_RESULT_BASE}/${endpoint}/requests/${request_id}`,
          { headers: { Authorization: `Key ${falKey}` } },
        );

        if (!resultRes.ok) {
          throw new Error(`fal.ai result fetch failed: ${resultRes.status}`);
        }

        const data = await resultRes.json();
        const videoUrl = data.video?.url;
        if (!videoUrl) throw new Error('fal.ai: completed but no video URL returned');

        console.log(`[kling] fal.ai generation complete: ${videoUrl}`);

        return {
          videoUrl,
          durationSeconds: request.duration,
          hasAudio: request.generateAudio ?? false,
          provider: 'fal',
          model,
          requestId: request_id,
          submittedAt,
          completedAt: new Date().toISOString(),
        };
      }

      if (status.status === 'FAILED') {
        throw new Error(`fal.ai generation failed: ${status.error || 'unknown error'}`);
      }

      // Still processing
      const elapsed = Math.round((poll + 1) * POLL_INTERVAL / 1000);
      callbacks.onProgress?.(`Generating video... (${elapsed}s)`);
    }

    throw new Error(`fal.ai: timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL / 1000}s`);
  }

  // ─── Wavespeed (async poll) ─────────────────────────────

  private async generateViaWavespeed(
    model: string,
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    const endpoint = WAVESPEED_ENDPOINTS[model];
    if (!endpoint) throw new Error(`Kling Wavespeed: unsupported model "${model}"`);
    const body = this.buildWavespeedBody(model, request);
    const job = await runWavespeedJob({
      endpoint, body, apiKey: apiKeys.wavespeed, tag: 'kling',
      label: VIDEO_MODEL_NAMES[model as VideoModelId] ?? model,
      onProgress: callbacks.onProgress, onRequestId: callbacks.onRequestId,
    });

    return {
      videoUrl: job.outputs[0],
      durationSeconds: request.duration,
      hasAudio: request.generateAudio ?? false,
      provider: 'wavespeed',
      model: model,
      requestId: job.requestId,
      submittedAt: job.submittedAt,
      completedAt: job.completedAt,
    };
  }

  // ─── Request body builders ──────────────────────────────

  private buildFalBody(model: string, req: VideoGenerationRequest): Record<string, unknown> {
    if (model === VIDEO_MODELS.KLING_V3) {
      return {
        start_image_url: req.sourceImageUrl,
        prompt: req.prompt,
        negative_prompt: req.negativePrompt || 'blur, distort, and low quality',
        duration: String(req.duration),
        aspect_ratio: req.aspectRatio,
        cfg_scale: req.cfgScale ?? 0.5,
        generate_audio: req.generateAudio ?? false,
        ...(req.endImageUrl && { end_image_url: req.endImageUrl }),
      };
    }

    // Kling 2.6 Motion Control
    return {
      image_url: req.sourceImageUrl,
      video_url: req.referenceVideoUrl,
      character_orientation: req.characterOrientation || 'image',
      ...(req.prompt && { prompt: req.prompt }),
      keep_original_sound: req.keepOriginalSound ?? true,
    };
  }

  private buildWavespeedBody(model: string, req: VideoGenerationRequest): Record<string, unknown> {
    if (model === VIDEO_MODELS.KLING_O3) {
      // Docs: image, prompt, last_image, duration 3-15, sound. No cfg/negative/aspect params.
      return {
        image: req.sourceImageUrl,
        prompt: req.prompt,
        duration: Math.min(Math.max(req.duration || 5, 3), 15),
        sound: req.generateAudio ?? true,
        ...(req.endImageUrl && { last_image: req.endImageUrl }),
      };
    }
    if (model === VIDEO_MODELS.KLING_V3) {
      return {
        image: req.sourceImageUrl,
        prompt: req.prompt,
        negative_prompt: req.negativePrompt || 'blur, distort, and low quality',
        duration: req.duration,
        cfg_scale: req.cfgScale ?? 0.5,
        sound: req.generateAudio ?? false,
        ...(req.endImageUrl && { end_image: req.endImageUrl }),
      };
    }

    // Kling 2.6 Motion Control
    return {
      image: req.sourceImageUrl,
      video: req.referenceVideoUrl,
      character_orientation: req.characterOrientation || 'image',
      ...(req.prompt && { prompt: req.prompt }),
      ...(req.negativePrompt && { negative_prompt: req.negativePrompt }),
      keep_original_sound: req.keepOriginalSound ?? true,
    };
  }
}
