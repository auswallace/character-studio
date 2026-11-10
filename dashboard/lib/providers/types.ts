// dashboard/lib/providers/types.ts

export interface GenerationRequest {
  prompt: string;
  images?: string[];        // reference image URLs (face, body, scene refs)
  numImages: number;
  resolution?: string;      // "2k", "4k" (Nanobanana) or "4096x4096" (Seedream size)
  aspectRatio?: string;     // "1:1", "9:16", "3:4" etc.
  imageSize?: string;       // raw pixel size "1728x2304" (passed to Seedream as size param)
  seed?: number;
  enableSync?: boolean;
  // Provider fields in the provider's own names (aspect_ratio, resolution, enable_web_search, ...).
  // Validated against lib/models/<endpoint>.json by buildInput before sending. Overrides the legacy fields above.
  params?: Record<string, unknown>;
}

export interface GenerationResult {
  imageUrls: string[];
  requestId: string | null;   // provider's job ID (for audit trail in generation_images)
  provider: string;           // "wavespeed" | "fal"
  model: string;              // display name used
  submittedAt: string;        // ISO timestamp
  completedAt: string;        // ISO timestamp
  endpoint?: string;          // provider endpoint id actually called
  providerInput?: Record<string, unknown>;   // exact JSON body sent (stored as generations.provider_input)
}

export interface InferenceProvider {
  readonly name: string;
  supportedModels(): string[];
  generate(
    model: string,
    request: GenerationRequest,
    onImage: (url: string, index: number) => void,
    onProgress?: (stage: string) => void,
  ): Promise<GenerationResult>;
  isHealthy(): boolean;
}

// Model name constants used across the app
export const MODEL_NAMES: Record<string, string> = {
  nanobanana: 'Nanobanana Pro',
  nanobanana2: 'Nanobanana 2',
  nanobanana21: 'Nanobanana 2.1',
  seedream50lite: 'Seedream 5.0 Lite',
  seedream45: 'Seedream 4.5',
  seedream40: 'Seedream 4.0',
};

export const NANOBANANA_MODELS = ['Nanobanana Pro', 'Nanobanana 2', 'Nanobanana 2.1'];
export const SEEDREAM_MODELS = ['Seedream 5.0 Lite', 'Seedream 4.5', 'Seedream 4.0'];
export const ALL_WAVESPEED_MODELS = [...NANOBANANA_MODELS, ...SEEDREAM_MODELS];
