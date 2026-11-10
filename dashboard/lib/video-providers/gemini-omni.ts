// dashboard/lib/video-providers/gemini-omni.ts
//
// Gemini Omni Flash video provider — Google, native synced audio, 3-10s, cheap.
// Wavespeed only (added Nov 2026).
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

const WAVESPEED_ENDPOINT = 'https://api.wavespeed.ai/api/v3/google/gemini-omni-flash/image-to-video';


// ─── Provider ─────────────────────────────────────────────

export class GeminiOmniVideoProvider implements VideoProvider {
  readonly name = 'gemini-omni';
  readonly supportedModels = [VIDEO_MODELS.GEMINI_OMNI_FLASH];

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
    // Docs list only: image, prompt, aspect_ratio (16:9 | 9:16), duration 3-10.
    const body: Record<string, unknown> = {
      image: request.sourceImageUrl,
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio === '9:16' ? '9:16' : '16:9',
      duration: Math.min(Math.max(request.duration || 8, 3), 10),
    };
    const job = await runWavespeedJob({
      endpoint, body, apiKey: apiKeys.wavespeed, tag: 'gemini-omni',
      label: 'gemini-omni',
      onProgress: callbacks.onProgress, onRequestId: callbacks.onRequestId,
    });

    return {
      videoUrl: job.outputs[0],
      durationSeconds: request.duration,
      hasAudio: true,
      provider: 'wavespeed',
      model: VIDEO_MODELS.GEMINI_OMNI_FLASH,
      requestId: job.requestId,
      submittedAt: job.submittedAt,
      completedAt: job.completedAt,
    };
  }
}
