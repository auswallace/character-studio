// dashboard/lib/providers/index.ts
//
// Barrel export — single import point for the provider system.
//
// Usage:
//   import { getProviderRouter, WavespeedProvider, MODEL_NAMES } from '@/lib/providers';

// Types & constants
export type { InferenceProvider, GenerationRequest, GenerationResult } from './types';
export { MODEL_NAMES, NANOBANANA_MODELS, SEEDREAM_MODELS, ALL_WAVESPEED_MODELS } from './types';

// Wavespeed provider + related types/utils
export { WavespeedProvider, calculateAspectRatio, aspectRatioToSize } from './wavespeed';
export type { WavespeedGenerationResult, NanobanaImageResult } from './wavespeed';

// Fal provider (fallback)
export { FalProvider } from './fal';

// Router
export { ProviderRouter, getProviderRouter, invalidateProviderRouter } from './router';
