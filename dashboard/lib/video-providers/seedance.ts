// dashboard/lib/video-providers/seedance.ts
//
// Seedance video provider — supports both 1.5 Pro and 2.0.
// fal.ai primary, Wavespeed fallback.
// Async queue pattern: submit → poll → result.

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

// fal.ai endpoints
const FAL_ENDPOINTS: Record<string, string> = {
  [VIDEO_MODELS.SEEDANCE_1_5]: 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  [VIDEO_MODELS.SEEDANCE_2_0]: 'bytedance/seedance-2.0/image-to-video',
};
const FAL_BASE = 'https://queue.fal.run';

// Wavespeed endpoints
const WAVESPEED_ENDPOINTS: Record<string, string> = {
  [VIDEO_MODELS.SEEDANCE_1_5]: 'https://api.wavespeed.ai/api/v3/bytedance/seedance-v1.5-pro/image-to-video',
  [VIDEO_MODELS.SEEDANCE_2_0]: 'https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/image-to-video',
  [VIDEO_MODELS.SEEDANCE_2_5]: 'https://api.wavespeed.ai/api/v3/bytedance/seedance-2.5/image-to-video',
};

const POLL_INTERVAL = 5000;
const MAX_POLL_ATTEMPTS = 120;   // ~10 min

// Max duration per model
const MAX_DURATION: Record<string, number> = {
  [VIDEO_MODELS.SEEDANCE_1_5]: 12,
  [VIDEO_MODELS.SEEDANCE_2_0]: 10,  // 2.0 only accepts 5 or 10 on fal.ai early access
  [VIDEO_MODELS.SEEDANCE_2_5]: 30,  // 2.5: 4-30s single shot (Wavespeed docs, Nov 2026)
};

// ─── Provider ─────────────────────────────────────────────

export class SeedanceVideoProvider implements VideoProvider {
  readonly name = 'seedance';
  readonly supportedModels = [VIDEO_MODELS.SEEDANCE_1_5, VIDEO_MODELS.SEEDANCE_2_0, VIDEO_MODELS.SEEDANCE_2_5];

  async generate(
    model: string,
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    // Seedance 2.0 on fal.ai requires early access approval we don't have yet.
    // Skip fal and go straight to Wavespeed to avoid unnecessary failure + delay.
    // Seedance 2.5 is Wavespeed-only for now (no fal endpoint wired).
    if (model === VIDEO_MODELS.SEEDANCE_2_0 || model === VIDEO_MODELS.SEEDANCE_2_5) {
      return await this.generateViaWavespeed(model, request, callbacks);
    }

    try {
      return await this.generateViaFal(model, request, callbacks);
    } catch (falError) {
      const falMsg = falError instanceof Error ? falError.message : String(falError);
      console.warn(`[seedance] fal.ai failed: ${falMsg}, trying Wavespeed fallback...`);
      callbacks.onProgress?.('fal.ai failed, trying Wavespeed...');
      return await this.generateViaWavespeed(model, request, callbacks);
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

    const endpoint = FAL_ENDPOINTS[model] || FAL_ENDPOINTS[VIDEO_MODELS.SEEDANCE_1_5];
    const maxDur = MAX_DURATION[model] || 12;
    const displayName = VIDEO_MODEL_NAMES[model as VideoModelId] ?? 'Seedance 1.5';
    const submittedAt = new Date().toISOString();

    const body: Record<string, unknown> = {
      prompt: request.prompt,
      image_url: request.sourceImageUrl,
      aspect_ratio: request.aspectRatio || '16:9',
      resolution: request.resolution || '1080p',
      duration: String(Math.min(request.duration || 5, maxDur)),
      generate_audio: request.generateAudio ?? true,
      camera_fixed: request.cameraFixed ?? false,
      enable_safety_checker: false,
      ...(request.endImageUrl && { end_image_url: request.endImageUrl }),
      ...(request.seed !== undefined && request.seed >= 0 && { seed: request.seed }),
    };

    console.log(`[seedance] Submitting to fal.ai queue (${displayName})...`);
    callbacks.onProgress?.(`Submitting to fal.ai (${displayName})...`);

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

    console.log(`[seedance] fal.ai request_id: ${request_id}`);
    callbacks.onRequestId?.(request_id, 'fal');
    callbacks.onProgress?.('Queued, waiting for generation...');

    // Poll for result
    for (let poll = 0; poll < MAX_POLL_ATTEMPTS; poll++) {
      await sleep(POLL_INTERVAL);

      const statusRes = await fetch(
        `${FAL_BASE}/${endpoint}/requests/${request_id}/status`,
        { headers: { Authorization: `Key ${falKey}` } },
      );

      if (!statusRes.ok) {
        console.warn(`[seedance] fal.ai status poll ${poll + 1} failed: HTTP ${statusRes.status}`);
        continue;
      }
      const status = await statusRes.json();
      console.log(`[seedance] fal.ai poll ${poll + 1}: status=${status.status}`);

      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(
          `${FAL_BASE}/${endpoint}/requests/${request_id}`,
          { headers: { Authorization: `Key ${falKey}` } },
        );

        if (!resultRes.ok) {
          throw new Error(`fal.ai result fetch failed: ${resultRes.status}`);
        }

        const data = await resultRes.json();
        const videoUrl = data.video?.url;
        if (!videoUrl) throw new Error('fal.ai: completed but no video URL returned');

        console.log(`[seedance] fal.ai generation complete: ${videoUrl}`);

        return {
          videoUrl,
          durationSeconds: request.duration,
          hasAudio: request.generateAudio ?? true,
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
    const endpoint = WAVESPEED_ENDPOINTS[model] || WAVESPEED_ENDPOINTS[VIDEO_MODELS.SEEDANCE_1_5];
    const maxDur = MAX_DURATION[model] || 12;
    const body: Record<string, unknown> = {
      image: request.sourceImageUrl,
      prompt: request.prompt,
      resolution: request.resolution || '1080p',
      duration: Math.min(request.duration || 5, maxDur),
      generate_audio: request.generateAudio ?? true,
      // 2.5 without aspect_ratio defaulted to a near-square frame and center-cropped a 9:16
      // start image (first test, 2026-11-04). Always send it. camera_fixed is still undocumented for 2.5.
      aspect_ratio: request.aspectRatio || '9:16',
      ...(model !== VIDEO_MODELS.SEEDANCE_2_5 && { camera_fixed: request.cameraFixed ?? false }),
      ...(request.endImageUrl && { last_image: request.endImageUrl }),
      ...(request.seed !== undefined && request.seed >= 0 && { seed: request.seed }),
    };
    const job = await runWavespeedJob({
      endpoint, body, apiKey: apiKeys.wavespeed, tag: 'seedance',
      label: VIDEO_MODEL_NAMES[model as VideoModelId] ?? model,
      onProgress: callbacks.onProgress, onRequestId: callbacks.onRequestId,
    });

    return {
      videoUrl: job.outputs[0],
      durationSeconds: request.duration,
      hasAudio: request.generateAudio ?? true,
      provider: 'wavespeed',
      model: model,
      requestId: job.requestId,
      submittedAt: job.submittedAt,
      completedAt: job.completedAt,
    };
  }
}
