// dashboard/lib/providers/wavespeed.ts
//
// Encapsulates ALL Wavespeed HTTP calls, polling, and retry logic.
// Extracted from generate/route.ts and remix/route.ts to eliminate
// ~400 lines of duplicated inline code.
//
// This class does NOT:
//   - Access Supabase (no database saves)
//   - Call stripImageMetadata() (post-processing stays in routes)
//   - Write SSE events directly (uses onImage/onProgress callbacks)
//
// This class DOES:
//   - Make all HTTP calls to Wavespeed endpoints
//   - Handle retries, polling, timeouts
//   - Call onImage(url, index) as each image URL becomes available
//   - Call onProgress(stage) for status updates
//   - Return GenerationResult with all image URLs + audit metadata

import {
  InferenceProvider,
  GenerationRequest,
  GenerationResult,
  NANOBANANA_MODELS,
  SEEDREAM_MODELS,
} from './types';
import { apiKeys } from '@/lib/supabase';
import { buildInput } from '@/lib/models/manifest';

const wsEndpointId = (url: string) => url.replace(/^https:\/\/api\.wavespeed\.ai\/api\/v3\//, '');

// ─── Constants ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const SEEDREAM_ENDPOINTS: Record<string, string> = {
  'Seedream 5.0 Lite': 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.0-lite/edit-sequential', // $0.035/img, 10 refs
  'Seedream 4.5': 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v4.5/edit-sequential',
  'Seedream 4.0': 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v4/edit-sequential',
};

const NANOBANANA_ENDPOINTS: Record<string, string> = {
  'Nanobanana Pro': 'https://api.wavespeed.ai/api/v3/google/nano-banana-pro/edit',
  'Nanobanana 2': 'https://api.wavespeed.ai/api/v3/google/nano-banana-2/edit',
  'Nanobanana 2.1': 'https://api.wavespeed.ai/api/v3/google/nano-banana-2.1/edit', // Oct 2026, up to 14 refs
};

const POLL_BASE = 'https://api.wavespeed.ai/api/v3/predictions';
const POLL_INTERVAL = 5000;        // 5s between polls
const MAX_POLL_ATTEMPTS = 24;      // ~2 min total poll timeout — fail fast, let fal fallback handle it
const SEEDREAM_TIMEOUT = 120000;   // 2 min for sync Seedream request — fail fast for fal fallback
const NANOBANANA_SYNC_TIMEOUT = 120000;  // 2 min (unused now — Nanobanana uses async+poll)

// ─── Per-image metadata (for Nanobanana audit trail) ───────

export interface NanobanaImageResult {
  imageUrl: string;
  wavespeedRequestId: string | null;
  submittedAt: string;
  completedAt: string;
}

// Extended result that includes per-image metadata for routes
// that need to save wavespeed_request_id per image row
export interface WavespeedGenerationResult extends GenerationResult {
  perImageResults?: NanobanaImageResult[];
}

// ─── WavespeedProvider ─────────────────────────────────────

export class WavespeedProvider implements InferenceProvider {
  readonly name = 'wavespeed';
  private lastSuccess = true;

  supportedModels(): string[] {
    return [...NANOBANANA_MODELS, ...SEEDREAM_MODELS];
  }

  isHealthy(): boolean {
    return this.lastSuccess;
  }

  async generate(
    model: string,
    request: GenerationRequest,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
  ): Promise<WavespeedGenerationResult> {
    const wavespeedKey = apiKeys.wavespeed;
    if (!wavespeedKey) throw new Error('Wavespeed API key not configured');

    try {
      let result: WavespeedGenerationResult;
      if (NANOBANANA_MODELS.includes(model)) {
        result = await this.generateNanobanana(wavespeedKey, model, request, onImage, onProgress);
      } else if (SEEDREAM_MODELS.includes(model)) {
        result = await this.generateSeedream(wavespeedKey, model, request, onImage, onProgress);
      } else {
        throw new Error(`WavespeedProvider: unsupported model "${model}"`);
      }
      this.lastSuccess = true;
      return result;
    } catch (err) {
      this.lastSuccess = false;
      throw err;
    }
  }

  // ─── Seedream (single batch request, sync mode + async poll fallback) ───
  //
  // Extracted from generate/route.ts generateImagesWavespeed()
  // and remix/route.ts generateImagesWavespeed() — both identical.
  //
  // Sends one request with max_images param. Seedream returns all images
  // at once in sync mode. If it falls back to async (returns request ID
  // instead of outputs), we poll until complete.
  // Retries up to maxRetries times on 504/5xx errors.

  private async generateSeedream(
    apiKey: string,
    model: string,
    request: GenerationRequest,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
    maxRetries = 1,
  ): Promise<WavespeedGenerationResult> {
    const endpoint = SEEDREAM_ENDPOINTS[model];
    if (!endpoint) throw new Error(`No Seedream endpoint for model "${model}"`);

    const images = (request.images || []).filter(Boolean);
    const { numImages, prompt } = request;

    // Seedream requires image count in prompt text (not just max_images param)
    // Place at END of prompt — Seedream front-loads word priority, so the scene
    // description should occupy the highest-priority position at the start.
    const countRegex = /\b\d+\s+images?\b/i;
    const wavespeedPrompt = countRegex.test(prompt)
      ? prompt
      : `${prompt} Generate a series of ${numImages} images.`;

    // Seedream uses size param with '*' separator (e.g. "1728*2304")
    const size = (request.imageSize || '1728x2304').replace(/x/i, '*');

    // User params (none exposed for Seedream today) validated against the manifest; app-managed fields win.
    const built = buildInput(wsEndpointId(endpoint), request.params || {}, {
      prompt: wavespeedPrompt, images, size, max_images: numImages, enable_base64_output: false, enable_sync_mode: true,
    });
    if (built.notes.length) console.log(`[wavespeed] ${model} manifest notes: ${built.notes.join('; ')}`);
    const requestBody = built.body;
    const meta = { endpoint: wsEndpointId(endpoint), providerInput: requestBody };

    const submittedAt = new Date().toISOString();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`[wavespeed] ${model}: retry ${attempt}/${maxRetries}...`);
        await sleep(5000); // Brief pause before retry
      }

      console.log(`[wavespeed] Calling ${model} (sync mode)${attempt > 0 ? ` [attempt ${attempt + 1}]` : ''}...`);
      // 5-minute timeout for sync mode
      const controller = new AbortController();
      const submitTimeout = setTimeout(() => controller.abort(), SEEDREAM_TIMEOUT);

      try {
        const submitRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(submitTimeout);

        // Retry on 504 Gateway Timeout (Wavespeed infra issue)
        if (submitRes.status === 504) {
          if (attempt < maxRetries) {
            console.warn(`[wavespeed] ${model}: 504 gateway timeout, will retry...`);
            continue;
          }
          throw new Error(`Wavespeed 504 gateway timeout after ${maxRetries + 1} attempts`);
        }

        if (!submitRes.ok) {
          const errText = await submitRes.text();
          // Retry on 5xx server errors
          if (submitRes.status >= 500 && attempt < maxRetries) {
            console.warn(`[wavespeed] ${model}: ${submitRes.status} error, will retry...`);
            continue;
          }
          throw new Error(`Wavespeed submit error ${submitRes.status}: ${errText}`);
        }

        const submitData = await submitRes.json();
        if (submitData.code !== 200) {
          throw new Error(`Wavespeed error: ${submitData.message || JSON.stringify(submitData)}`);
        }

        // Sync mode — images returned directly
        const outputs = submitData.data?.outputs || [];
        const imageUrls = outputs.map((o: string | { url: string }) =>
          typeof o === 'string' ? o : o.url
        );

        if (imageUrls.length > 0) {
          console.log(`[wavespeed] ${model} returned ${imageUrls.length} images${attempt > 0 ? ` (retry ${attempt})` : ''}`);
          imageUrls.forEach((url: string, i: number) => onImage(url, i));
          return {
            imageUrls,
            requestId: submitData.data?.id || null,
            provider: this.name,
            model,
            submittedAt,
            completedAt: new Date().toISOString(),
            ...meta,
          };
        }

        // No outputs — check if async mode (has request ID for polling)
        const requestId = submitData.data?.id;
        if (requestId) {
          return { ...await this.pollForCompletion(apiKey, requestId, model, numImages, submittedAt, onImage, onProgress), ...meta };
        }

        // No outputs and no request ID
        return {
          imageUrls: [],
          requestId: null,
          provider: this.name,
          model,
          submittedAt,
          completedAt: new Date().toISOString(),
          ...meta,
        };

      } catch (err: unknown) {
        clearTimeout(submitTimeout);
        if (err instanceof Error && err.name === 'AbortError') {
          if (attempt < maxRetries) {
            console.warn(`[wavespeed] ${model}: fetch timeout, will retry...`);
            continue;
          }
          throw new Error(`Wavespeed timed out after ${maxRetries + 1} attempts`);
        }
        throw err;
      }
    }

    throw new Error(`Wavespeed ${model}: exhausted retries`);
  }

  // ─── Nanobanana (N parallel async requests, each polled individually) ───
  //
  // Extracted from generate/route.ts generateNanobananaStreaming()
  // and remix/route.ts generateNanobananaStreaming().
  //
  // Fires numImages parallel requests, each in async mode to avoid 504s.
  // Each image streams back independently via onImage callback.
  // Returns all successful image URLs + per-image audit metadata.

  private async generateNanobanana(
    apiKey: string,
    model: string,
    request: GenerationRequest,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
  ): Promise<WavespeedGenerationResult> {
    const endpoint = NANOBANANA_ENDPOINTS[model];
    if (!endpoint) throw new Error(`No Nanobanana endpoint for model "${model}"`);

    const images = (request.images || []).filter(Boolean);
    const { numImages, prompt } = request;

    // Nanobanana uses aspect_ratio and resolution instead of size
    const aspectRatio = request.aspectRatio || calculateAspectRatio(request.imageSize || '1024x1024');
    const resolution = request.resolution || '2k';

    // Legacy aspectRatio/resolution feed the same manifest fields; request.params (provider names) override them.
    const built = buildInput(wsEndpointId(endpoint), { aspect_ratio: aspectRatio, resolution, ...(request.params || {}) }, {
      prompt, images, output_format: 'png', enable_base64_output: false,
    });
    if (built.notes.length) console.log(`[wavespeed] ${model} manifest notes: ${built.notes.join('; ')}`);
    const requestBody = built.body;

    console.log(`[wavespeed] Nanobanana: firing ${numImages} parallel requests (async+poll, ${resolution}, ${aspectRatio})...`);
    onProgress?.(`Generating ${numImages} images in parallel...`);

    const submittedAt = new Date().toISOString();
    const imageUrls: string[] = [];
    const perImageResults: NanobanaImageResult[] = [];
    let imageCount = 0;
    let failedCount = 0;

    const perImagePromises = Array.from({ length: numImages }, async (_, i) => {
      try {
        const result = await this.nanobanaSingleRequest(
          apiKey, endpoint, requestBody, i + 1, numImages,
        );
        imageCount++;
        imageUrls.push(result.imageUrl);
        perImageResults.push(result);
        // Stream to caller IMMEDIATELY when THIS image finishes
        onImage(result.imageUrl, imageCount - 1);
      } catch (err) {
        failedCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[wavespeed] Nanobanana ${i + 1}/${numImages} failed: ${errMsg}`);
      }
    });

    await Promise.allSettled(perImagePromises);

    if (imageCount === 0) {
      throw new Error(`All ${numImages} Nanobanana requests failed`);
    }

    return {
      imageUrls,
      requestId: null, // N separate requests, no single ID
      provider: this.name,
      model,
      submittedAt,
      completedAt: new Date().toISOString(),
      perImageResults,
      endpoint: wsEndpointId(endpoint),
      providerInput: requestBody,
    };
  }

  // ─── Single Nanobanana request (async submit + poll) ──────
  //
  // Submits in async mode (enable_sync_mode: false) to get a request ID
  // immediately, then polls for completion. This avoids the 504 Gateway
  // Timeout that happens when sync mode takes too long.
  //
  // If Wavespeed returns images directly (sync behavior despite async flag),
  // we use them immediately without polling.

  private async nanobanaSingleRequest(
    apiKey: string,
    endpoint: string,
    requestBody: Record<string, unknown>,
    requestNum: number,
    total: number,
  ): Promise<NanobanaImageResult> {
    const asyncBody = { ...requestBody, enable_sync_mode: false };
    const submittedAt = new Date().toISOString();

    // Submit timeout — async submit should return quickly (just queuing)
    const ac = new AbortController();
    const submitTimeout = setTimeout(() => ac.abort(), 60000); // 60s for submit only

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(asyncBody),
        signal: ac.signal,
      });

      clearTimeout(submitTimeout);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Request ${requestNum}/${total} error ${res.status}: ${errText.substring(0, 200)}`);
      }

      const data = await res.json();
      if (data.code !== 200) {
        throw new Error(`Request ${requestNum}/${total}: ${data.message || JSON.stringify(data)}`);
      }

      // Check if images returned directly (some models return inline even in async mode)
      const outputs = data.data?.outputs || [];
      if (outputs.length > 0) {
        const url = outputs[0];
        const imageUrl = typeof url === 'string' ? url : url.url;
        console.log(`[wavespeed] Nanobanana ${requestNum}/${total} done (immediate, request: ${data.data?.id || 'n/a'})`);
        return {
          imageUrl,
          wavespeedRequestId: data.data?.id || null,
          submittedAt,
          completedAt: new Date().toISOString(),
        };
      }

      // Async mode — got request ID, now poll for completion
      const requestId = data.data?.id;
      if (requestId) {
        console.log(`[wavespeed] Nanobanana ${requestNum}/${total} queued (request: ${requestId}), polling...`);
        return await this.pollSingleNanobanana(apiKey, requestId, requestNum, total, submittedAt);
      }

      throw new Error(`Request ${requestNum}/${total}: no outputs and no request ID`);
    } catch (err: unknown) {
      clearTimeout(submitTimeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request ${requestNum}/${total}: submit timed out (60s)`);
      }
      throw err;
    }
  }

  // ─── Single Nanobanana poll (async fallback) ──────────────
  //
  // When sync mode returns a request ID but no images, poll until
  // the job completes. Same pattern as Seedream's pollForCompletion
  // but returns a single NanobanaImageResult.

  private async pollSingleNanobanana(
    apiKey: string,
    requestId: string,
    requestNum: number,
    total: number,
    submittedAt: string,
  ): Promise<NanobanaImageResult> {
    const pollEndpoint = `${POLL_BASE}/${requestId}/result`;

    for (let poll = 0; poll < MAX_POLL_ATTEMPTS; poll++) {
      await sleep(POLL_INTERVAL);

      const pollRes = await fetch(pollEndpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!pollRes.ok) {
        console.warn(`[wavespeed] Nanobanana ${requestNum}/${total} poll ${poll + 1}: HTTP ${pollRes.status}`);
        continue;
      }

      const pollData = await pollRes.json();
      if (pollData.code !== 200) {
        throw new Error(`Nanobanana poll error: ${pollData.message}`);
      }

      const status = pollData.data?.status;
      if (status === 'completed') {
        const outputs = pollData.data?.outputs || [];
        if (outputs.length === 0) throw new Error(`Nanobanana ${requestNum}/${total}: completed but no outputs`);
        const url = outputs[0];
        const imageUrl = typeof url === 'string' ? url : url.url;
        console.log(`[wavespeed] Nanobanana ${requestNum}/${total} done (async poll, ${poll + 1} polls, request: ${requestId})`);
        return {
          imageUrl,
          wavespeedRequestId: requestId,
          submittedAt,
          completedAt: new Date().toISOString(),
        };
      } else if (status === 'failed') {
        throw new Error(`Nanobanana ${requestNum}/${total} failed (${requestId}): ${pollData.data?.error || 'unknown'}`);
      }

      if ((poll + 1) % 5 === 0) {
        console.log(`[wavespeed] Nanobanana ${requestNum}/${total} poll ${poll + 1}/${MAX_POLL_ATTEMPTS}: ${status || 'processing'}...`);
      }
    }

    throw new Error(`Nanobanana ${requestNum}/${total} timed out after polling (${requestId})`);
  }

  // ─── Shared polling for Seedream async fallback ─────────
  //
  // When Seedream returns a request ID instead of direct outputs,
  // we poll every 5s up to 60 attempts (~5 min).

  private async pollForCompletion(
    apiKey: string,
    requestId: string,
    model: string,
    numImages: number,
    submittedAt: string,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
  ): Promise<WavespeedGenerationResult> {
    console.log(`[wavespeed] ${model} async mode — polling request ${requestId}...`);
    const pollEndpoint = `${POLL_BASE}/${requestId}/result`;

    for (let poll = 0; poll < MAX_POLL_ATTEMPTS; poll++) {
      await sleep(POLL_INTERVAL);

      const pollRes = await fetch(pollEndpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!pollRes.ok) {
        console.warn(`[wavespeed] Poll ${poll + 1}/${MAX_POLL_ATTEMPTS}: HTTP ${pollRes.status}`);
        continue;
      }

      const pollData = await pollRes.json();
      if (pollData.code !== 200) {
        throw new Error(`Wavespeed polling error: ${pollData.message}`);
      }

      const status = pollData.data?.status;
      if (status === 'completed') {
        const outputs = pollData.data?.outputs || [];
        if (outputs.length === 0) throw new Error('Wavespeed returned no images after polling');
        const imageUrls = outputs.map((o: string | { url: string }) =>
          typeof o === 'string' ? o : o.url
        );
        imageUrls.forEach((url: string, i: number) => onImage(url, i));
        console.log(`[wavespeed] Done after ${poll + 1} polls (${imageUrls.length} images, request: ${requestId})`);
        return {
          imageUrls,
          requestId,
          provider: this.name,
          model,
          submittedAt,
          completedAt: new Date().toISOString(),
        };
      } else if (status === 'failed') {
        throw new Error(`Wavespeed generation failed (${requestId}): ${pollData.data?.error || 'unknown'}`);
      }

      if ((poll + 1) % 3 === 0) {
        onProgress?.(`Still generating... (${(poll + 1) * 5}s elapsed)`);
      }
      if ((poll + 1) % 5 === 0) {
        console.log(`[wavespeed] Poll ${poll + 1}/${MAX_POLL_ATTEMPTS}: ${status || 'processing'}...`);
      }
    }

    throw new Error(`Wavespeed generation timed out after polling (${requestId})`);
  }
}

// ─── Utility: Map aspect ratio string to pixel dimensions ───

const ASPECT_RATIO_SIZES: Record<string, string> = {
  '1:1':  '2048x2048',
  '9:16': '1440x2560',
  '16:9': '2560x1440',
  '4:5':  '1638x2048',
  '5:4':  '2048x1638',
  '3:4':  '1536x2048',
  '4:3':  '2048x1536',
  '2:3':  '1365x2048',
  '3:2':  '2048x1365',
  '21:9': '2560x1097',
};

export function aspectRatioToSize(ar: string): string {
  return ASPECT_RATIO_SIZES[ar] || '1440x2560';
}

// ─── Utility: Map pixel dimensions to Wavespeed aspect_ratio ───
//
// Extracted from generate/route.ts calculateAspectRatio().
// Uses closest-match against valid Nanobanana aspect ratios:
//   1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9

export function calculateAspectRatio(imageSize: string): string {
  const [width, height] = imageSize.split(/x/i).map(Number);
  if (!width || !height) return '9:16'; // default fallback

  const ratio = width / height;
  const ratios: [number, string][] = [
    [1,      '1:1'],
    [9 / 16, '9:16'],
    [16 / 9, '16:9'],
    [4 / 5,  '4:5'],
    [5 / 4,  '5:4'],
    [3 / 4,  '3:4'],
    [4 / 3,  '4:3'],
    [2 / 3,  '2:3'],
    [3 / 2,  '3:2'],
    [21 / 9, '21:9'],
  ];

  let bestMatch = '9:16'; // default fallback
  let bestDiff = Infinity;
  for (const [target, label] of ratios) {
    const diff = Math.abs(ratio - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMatch = label;
    }
  }
  return bestMatch;
}
