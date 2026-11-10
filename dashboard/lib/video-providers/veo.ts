// dashboard/lib/video-providers/veo.ts
//
// Veo 3.1 video provider — cinematic quality, native audio.
// Wavespeed primary (fal.ai availability TBD).
// Async poll pattern: submit → poll → result.

import {
  VideoProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
  VIDEO_MODELS,
} from './types';
import { apiKeys } from '@/lib/supabase';
import { runWavespeedJob } from '@/lib/wavespeed-poll';

// ─── Constants ────────────────────────────────────────────

const WAVESPEED_ENDPOINT = 'https://api.wavespeed.ai/api/v3/google/veo3.1-fast/image-to-video';


// ─── Provider ─────────────────────────────────────────────

export class VeoVideoProvider implements VideoProvider {
  readonly name = 'veo';
  readonly supportedModels = [VIDEO_MODELS.VEO_3_1];

  async generate(
    model: string,
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    return await this.generateViaWavespeed(request, callbacks);
  }

  // ─── Wavespeed (async poll) ─────────────────────────────

  private async generateViaWavespeed(
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    const endpoint = WAVESPEED_ENDPOINT;
    const body: Record<string, unknown> = {
      image: request.sourceImageUrl,
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio || '16:9',
      duration: request.duration || 8,
      resolution: request.resolution || '1080p',
      generate_audio: request.generateAudio ?? true,
      ...(request.negativePrompt && { negative_prompt: request.negativePrompt }),
      ...(request.endImageUrl && { last_image: request.endImageUrl }),
      ...(request.seed !== undefined && request.seed >= 0 && { seed: request.seed }),
    };
    const job = await runWavespeedJob({
      endpoint, body, apiKey: apiKeys.wavespeed, tag: 'veo',
      label: 'veo',
      onProgress: callbacks.onProgress, onRequestId: callbacks.onRequestId,
    });

    return {
      videoUrl: job.outputs[0],
      durationSeconds: request.duration,
      hasAudio: request.generateAudio ?? true,
      provider: 'wavespeed',
      model: VIDEO_MODELS.VEO_3_1,
      requestId: job.requestId,
      submittedAt: job.submittedAt,
      completedAt: job.completedAt,
    };
  }
}
