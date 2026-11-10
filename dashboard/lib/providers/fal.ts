// dashboard/lib/providers/fal.ts
//
// FalProvider — fallback inference provider using fal.ai's direct API.
//
// fal.ai hosts the SAME models as Wavespeed (Nanobanana Pro, Seedream 4.0/4.5)
// so fallback uses the identical model, just on different infrastructure.
//
// API pattern: POST to https://fal.run/{model_id} — sync response with images.
// Auth: "Key <FAL_KEY>" header on all requests.
// Matches batch-processor.js behavior exactly.

import {
  InferenceProvider,
  GenerationRequest,
  GenerationResult,
} from './types';
import { apiKeys } from '@/lib/supabase';
import { buildInput } from '@/lib/models/manifest';

// ─── Constants ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// fal.ai endpoint for each model — these are the SAME models as Wavespeed
const FAL_ENDPOINTS: Record<string, string> = {
  'Nanobanana Pro': 'https://fal.run/fal-ai/nano-banana-pro/edit',
  'Nanobanana 2':   'https://fal.run/fal-ai/nano-banana-2/edit',
  'Seedream 4.5':   'https://fal.run/fal-ai/bytedance/seedream/v4.5/edit',
  'Seedream 4.0':   'https://fal.run/fal-ai/bytedance/seedream/v4/edit',
};

const SYNC_TIMEOUT = 300000; // 5 min — matches batch-processor

// ─── FalProvider ─────────────────────────────────────────────

export class FalProvider implements InferenceProvider {
  readonly name = 'fal';
  private lastSuccess = true;

  supportedModels(): string[] {
    return Object.keys(FAL_ENDPOINTS);
  }

  isHealthy(): boolean {
    return this.lastSuccess;
  }

  async generate(
    model: string,
    request: GenerationRequest,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
  ): Promise<GenerationResult> {
    const falKey = apiKeys.fal;
    if (!falKey) throw new Error('fal.ai API key not configured');

    const endpoint = FAL_ENDPOINTS[model];
    if (!endpoint) {
      throw new Error(`FalProvider: unsupported model "${model}". Supported: ${Object.keys(FAL_ENDPOINTS).join(', ')}`);
    }

    try {
      const result = await this.generateSync(
        falKey, endpoint, model, request, onImage, onProgress,
      );
      this.lastSuccess = true;
      return result;
    } catch (err) {
      this.lastSuccess = false;
      throw err;
    }
  }

  // ─── Sync generation (matches batch-processor) ─────────────
  //
  // POST to https://fal.run/{model_id} with the same request body format
  // the batch-processor uses. fal.ai processes and returns images directly.

  private async generateSync(
    apiKey: string,
    endpoint: string,
    model: string,
    request: GenerationRequest,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
  ): Promise<GenerationResult> {
    const { prompt, numImages, images } = request;
    const isNanobanana = model === 'Nanobanana Pro' || model === 'Nanobanana 2';
    const submittedAt = new Date().toISOString();

    // Build request body — matches batch-processor format exactly
    // fal.ai uses image_urls (not images), and image_size or aspect_ratio
    const imageUrls = (images || []).filter(Boolean);

    let body: Record<string, unknown>;

    if (isNanobanana) {
      // Nanobanana uses aspect_ratio + resolution (same as batch-processor line 970-976)
      const aspectRatio = request.aspectRatio || '9:16';
      // fal's nano-banana-2/edit manifest is in lib/models; resolution there is upper-case (1K/2K/4K).
      const p = { ...(request.params || {}) };
      if (typeof p.resolution === 'string') p.resolution = p.resolution.toUpperCase();
      const built = buildInput(endpoint.replace('https://fal.run/', ''), { aspect_ratio: aspectRatio, resolution: (request.resolution || '2k').toUpperCase(), ...(model === 'Nanobanana 2' && { safety_tolerance: '6' }), ...p }, {
        prompt, image_urls: imageUrls, num_images: Math.min(numImages, 4), output_format: 'png',
      });
      if (built.notes.length) console.log(`[fal] ${model} manifest notes: ${built.notes.join('; ')}`);
      body = built.body;
    } else {
      // Seedream uses image_size: {width, height} (same as batch-processor line 834-840)
      const size = request.imageSize || '1440x2560';
      const [width, height] = size.split('x').map(Number);
      const built = buildInput(endpoint.replace('https://fal.run/', ''), { enable_safety_checker: false, ...(request.params || {}) }, {
        prompt, image_urls: imageUrls, num_images: numImages, image_size: { width: width || 1440, height: height || 2560 },
      });
      if (built.notes.length) console.log(`[fal] ${model} manifest notes: ${built.notes.join('; ')}`);
      body = built.body;
    }

    console.log(`[fal] Submitting to ${model} via fal.ai (${numImages} image(s))...`);
    onProgress?.(`Generating via fal.ai (${model})...`);

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), SYNC_TIMEOUT);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`fal.ai ${model} error ${res.status}: ${errText.substring(0, 300)}`);
      }

      const data = await res.json();

      // fal.ai returns images in data.images array
      const resultImages: Array<{ url: string }> = data.images || [];

      if (resultImages.length === 0) {
        throw new Error(`fal.ai ${model}: completed but returned no images`);
      }

      const resultUrls = resultImages.map(img => img.url);
      console.log(`[fal] Got ${resultUrls.length} image(s) from ${model}`);
      resultUrls.forEach((url, i) => onImage(url, i));

      return {
        imageUrls: resultUrls,
        requestId: null,
        provider: this.name,
        model,
        submittedAt,
        completedAt: new Date().toISOString(),
        endpoint: endpoint.replace('https://fal.run/', ''),
        providerInput: body,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`fal.ai ${model}: timed out (5min sync)`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
