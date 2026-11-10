// dashboard/lib/providers/router.ts
//
// ProviderRouter — routes generate() calls to the correct InferenceProvider
// with automatic fallback. Primary/fallback order is configurable via
// the app_settings table in Supabase (Settings > API Providers tab).
//
// Usage:
//   const router = getProviderRouter();
//   const result = await router.generate(model, request, onImage, onProgress);

import {
  InferenceProvider,
  GenerationRequest,
  GenerationResult,
} from './types';
import { WavespeedProvider } from './wavespeed';
import { FalProvider } from './fal';
import { isSimulating, simulatedImageUrl } from '@/lib/simulate';
import { apiKeys, supabase } from '@/lib/supabase';

// ─── Model equivalence between providers ─────────────────
// Maps model names to their equivalent on each provider.
// Both providers host the same models (Nanobanana Pro/2, Seedream 4.0/4.5).

const MODEL_EQUIVALENTS: Record<string, Record<string, string>> = {
  fal: {
    'Nanobanana Pro': 'Nanobanana Pro',
    'Nanobanana 2': 'Nanobanana 2',
    'Nanobanana 2.1': 'Nanobanana 2', // fal 2.1 endpoint not verified yet; fall back to 2
    'Seedream 5.0 Lite': 'Seedream 4.5', // fal 5.0 endpoint not verified yet; fall back to 4.5
    'Seedream 4.5': 'Seedream 4.5',
    'Seedream 4.0': 'Seedream 4.0',
  },
  wavespeed: {
    'Nanobanana Pro': 'Nanobanana Pro',
    'Nanobanana 2': 'Nanobanana 2',
    'Nanobanana 2.1': 'Nanobanana 2.1',
    'Seedream 5.0 Lite': 'Seedream 5.0 Lite',
    'Seedream 4.5': 'Seedream 4.5',
    'Seedream 4.0': 'Seedream 4.0',
  },
};

// ─── Config cache ────────────────────────────────────────
// Read provider config from Supabase with a short TTL cache
// so we don't query on every single generation request.

interface ProviderConfig {
  primaryProvider: string;
  fallbackProvider: string;
}

let _configCache: ProviderConfig | null = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 60000; // 60s

export async function getProviderConfig(): Promise<ProviderConfig> {
  const now = Date.now();
  if (_configCache && (now - _configCacheTime) < CONFIG_CACHE_TTL) {
    return _configCache;
  }

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['primary_provider', 'fallback_provider']);

    if (error) throw error;

    const config: ProviderConfig = {
      primaryProvider: 'wavespeed',
      fallbackProvider: 'fal',
    };

    for (const row of data || []) {
      if (row.key === 'primary_provider') config.primaryProvider = row.value;
      if (row.key === 'fallback_provider') config.fallbackProvider = row.value;
    }

    _configCache = config;
    _configCacheTime = now;
    return config;
  } catch (err) {
    console.warn('[router] Failed to read provider config from Supabase, using defaults:', err);
    return { primaryProvider: 'wavespeed', fallbackProvider: 'fal' };
  }
}

// ─── ProviderRouter ──────────────────────────────────────

export class ProviderRouter {
  private providers = new Map<string, InferenceProvider>();

  constructor() {
    // Register both providers (keyed by name)
    this.registerProvider(new WavespeedProvider());

    if (apiKeys.fal) {
      this.registerProvider(new FalProvider());
      console.log('[router] FalProvider registered (fal.ai available)');
    }
  }

  /** Register a provider instance. Keyed by provider.name. */
  registerProvider(provider: InferenceProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Retrieve a registered provider by name (or undefined). */
  getProvider(name: string): InferenceProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Route a generation request to the correct provider.
   *
   * 1. Read primary/fallback config from Supabase (cached)
   * 2. Map the model to the equivalent on the primary provider
   * 3. Try generating with the primary provider
   * 4. On failure, try the fallback provider
   * 5. If no fallback or fallback also fails, throw
   */
  async generate(
    model: string,
    request: GenerationRequest,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
  ): Promise<GenerationResult> {
    // Simulate mode: no provider call, labelled placeholder in the requested shape.
    if (await isSimulating()) {
      const submittedAt = new Date().toISOString();
      onProgress?.('Simulating (no provider call)...');
      const url = await simulatedImageUrl(request.aspectRatio || request.imageSize);
      const n = Math.max(1, request.numImages || 1);
      await new Promise(r => setTimeout(r, 1500));
      const imageUrls = Array.from({ length: n }, () => url);
      imageUrls.forEach((u, i) => onImage(u, i));
      console.log(`[router] SIMULATED ${n} image(s) for "${model}"`);
      return { imageUrls, requestId: null, provider: 'simulate', model, submittedAt, completedAt: new Date().toISOString(), endpoint: 'simulate', providerInput: { simulated: true, model, prompt: request.prompt, images: request.images || [], ...(request.params || {}) } };
    }
    const config = await getProviderConfig();
    const { primaryProvider: primaryName, fallbackProvider: fallbackName } = config;

    // Resolve primary provider
    const primary = this.providers.get(primaryName);
    if (!primary) {
      // Primary not available (e.g. fal set as primary but no API key) — try fallback directly
      console.warn(`[router] Primary provider "${primaryName}" not registered, trying fallback "${fallbackName}"...`);
      const fallback = this.providers.get(fallbackName);
      if (!fallback) throw new Error(`[router] Neither "${primaryName}" nor "${fallbackName}" is registered`);
      const fbModel = MODEL_EQUIVALENTS[fallbackName]?.[model] || model;
      return await fallback.generate(fbModel, request, onImage, onProgress);
    }

    // Map model to equivalent on primary provider
    const primaryModel = MODEL_EQUIVALENTS[primaryName]?.[model] || model;

    // Attempt primary provider
    try {
      console.log(`[router] Using primary provider "${primaryName}" for model "${primaryModel}"`);
      return await primary.generate(primaryModel, request, onImage, onProgress);
    } catch (primaryError) {
      console.error(
        `[router] Primary provider "${primaryName}" failed for model "${primaryModel}":`,
        primaryError instanceof Error ? primaryError.message : primaryError,
      );

      // Check for fallback
      const fallback = this.providers.get(fallbackName);
      if (!fallback) {
        console.warn(`[router] Fallback provider "${fallbackName}" not registered — re-throwing original error`);
        throw primaryError;
      }

      // Map model to equivalent on fallback provider
      const fallbackModel = MODEL_EQUIVALENTS[fallbackName]?.[model];
      if (!fallbackModel) {
        console.warn(`[router] No equivalent model for "${model}" on fallback "${fallbackName}" — re-throwing original error`);
        throw primaryError;
      }

      console.log(`[router] Falling back to "${fallbackName}" with model "${fallbackModel}"...`);
      onProgress?.(`Primary provider failed, trying ${fallbackName}...`);

      return await fallback.generate(fallbackModel, request, onImage, onProgress);
    }
  }
}

// ─── Singleton ───────────────────────────────────────────

let _router: ProviderRouter | null = null;

/** Get the shared ProviderRouter singleton. */
export function getProviderRouter(): ProviderRouter {
  if (!_router) {
    _router = new ProviderRouter();
  }
  return _router;
}

/** Invalidate the router + config cache (called when settings change). */
export function invalidateProviderRouter(): void {
  _router = null;
  _configCache = null;
  _configCacheTime = 0;
  console.log('[router] Provider router invalidated — will reload config on next request');
}
