// dashboard/lib/video-providers/wan.ts
//
// Wan 2.2 14B image-to-video with LoRA support (open model, hosted on WaveSpeed).
// Endpoint and fields read from the docs page on 2026-11-09; manifest in lib/models/wavespeed-ai-wan-2-2-i2v-720p-lora.json.
// 720p, 5 or 8 s, no audio, output follows the start image's aspect ratio. $0.07/s.
// The reason to have it: it is the one strong video model that loads a LoRA, so a Wan character LoRA
// can hold identity in motion the way the image LoRA does for stills.

import { VideoProvider, VideoGenerationRequest, VideoGenerationResult, VIDEO_MODELS } from './types';
import { apiKeys } from '@/lib/supabase';
import { runWavespeedJob } from '@/lib/wavespeed-poll';
import { buildInput } from '@/lib/models/manifest';

const ENDPOINT_ID = 'wavespeed-ai/wan-2.2/i2v-720p-lora';
const cleanLoras = (l?: { path: string; scale?: number }[]) =>
  (l || []).filter(x => x && /^https:\/\//.test(x.path)).slice(0, 3).map(x => ({ path: x.path, scale: Math.min(Math.max(Number(x.scale ?? 1) || 1, 0), 4) }));

export class WanVideoProvider implements VideoProvider {
  readonly name = 'wan';
  readonly supportedModels = [VIDEO_MODELS.WAN_2_2];

  async generate(
    _model: string,
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    if (!request.sourceImageUrl) throw new Error('Wan 2.2 needs a start image');
    const duration = request.duration >= 8 ? 8 : 5;   // the endpoint takes 5 or 8 only
    const loras = cleanLoras(request.loras), hi = cleanLoras(request.highNoiseLoras), lo = cleanLoras(request.lowNoiseLoras);
    const built = buildInput(ENDPOINT_ID, {}, {
      prompt: request.prompt,
      image: request.sourceImageUrl,
      duration,
      negative_prompt: request.negativePrompt || undefined,
      last_image: request.endImageUrl || undefined,
      loras: loras.length ? loras : undefined,
      high_noise_loras: hi.length ? hi : undefined,
      low_noise_loras: lo.length ? lo : undefined,
      seed: request.seed !== undefined && request.seed >= 0 ? request.seed : undefined,
    });
    const job = await runWavespeedJob({
      endpoint: `https://api.wavespeed.ai/api/v3/${ENDPOINT_ID}`, body: built.body, apiKey: apiKeys.wavespeed, tag: 'wan', label: 'wan',
      onProgress: callbacks.onProgress, onRequestId: callbacks.onRequestId,
    });
    return {
      videoUrl: job.outputs[0], durationSeconds: duration, hasAudio: false, provider: 'wavespeed', model: VIDEO_MODELS.WAN_2_2,
      requestId: job.requestId, submittedAt: job.submittedAt, completedAt: job.completedAt,
      providerInput: { endpoint: ENDPOINT_ID, ...built.body },
    };
  }
}

// Wan 2.2 Animate: one character image + one driving video. Fields read from the WaveSpeed docs page on 2026-11-10:
// image, video, prompt (optional), mode (animate | replace), resolution (480p | 720p), seed. $0.08/s at 720p, billed 3 to 120 s.
// Output length follows the driving video. No audio.
const ANIMATE_ENDPOINT_ID = 'wavespeed-ai/wan-2.2/animate';

export class WanAnimateProvider implements VideoProvider {
  readonly name = 'wan-animate';
  readonly supportedModels = [VIDEO_MODELS.WAN_ANIMATE];

  async generate(
    _model: string,
    request: VideoGenerationRequest,
    callbacks: { onProgress?: (stage: string) => void; onRequestId?: (requestId: string, provider: string) => void },
  ): Promise<VideoGenerationResult> {
    if (!request.sourceImageUrl) throw new Error('Wan Animate needs a character image');
    if (!request.referenceVideoUrl) throw new Error('Wan Animate needs a motion video');
    const body: Record<string, unknown> = {
      image: request.sourceImageUrl,
      video: request.referenceVideoUrl,
      mode: request.animateMode === 'replace' ? 'replace' : 'animate',
      resolution: request.resolution === '480p' ? '480p' : '720p',
    };
    if (request.prompt) body.prompt = request.prompt;
    if (request.seed !== undefined && request.seed >= 0) body.seed = request.seed;
    const job = await runWavespeedJob({
      endpoint: `https://api.wavespeed.ai/api/v3/${ANIMATE_ENDPOINT_ID}`, body, apiKey: apiKeys.wavespeed, tag: 'wan-animate', label: 'wan-animate',
      onProgress: callbacks.onProgress, onRequestId: callbacks.onRequestId,
    });
    return {
      videoUrl: job.outputs[0], durationSeconds: request.duration, hasAudio: false, provider: 'wavespeed', model: VIDEO_MODELS.WAN_ANIMATE,
      requestId: job.requestId, submittedAt: job.submittedAt, completedAt: job.completedAt,
      providerInput: { endpoint: ANIMATE_ENDPOINT_ID, ...body },
    };
  }
}
