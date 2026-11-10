// dashboard/lib/video-providers/types.ts
//
// Shared types for all video generation providers (Kling, Seedance, Veo).
// Separate from image providers — video APIs have fundamentally different
// parameters, async patterns, and output formats.

// ─── Request ──────────────────────────────────────────────

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  sourceImageUrl?: string;       // start frame
  endImageUrl?: string;          // end frame (optional)
  referenceVideoUrl?: string;    // motion source: Kling 2.6 motion control, Wan 2.2 Animate
  animateMode?: 'animate' | 'replace';   // Wan 2.2 Animate only. animate = the image character moves like the video; replace = the image character is put into the video
  characterOrientation?: 'image' | 'video';  // Kling 2.6 only
  keepOriginalSound?: boolean;   // Kling 2.6 only
  duration: number;              // seconds
  aspectRatio: string;           // '16:9' | '9:16' | '1:1' etc.
  resolution?: string;           // '480p' | '720p' | '1080p' | '4k'
  generateAudio?: boolean;
  cameraFixed?: boolean;         // Seedance only
  cfgScale?: number;             // Kling v3 only (0.0-1.0)
  seed?: number;
  // Wan 2.2 only: LoRAs (https URLs). `loras` hits both noise stages; high = motion/layout, low = detail/identity.
  loras?: { path: string; scale?: number }[];
  highNoiseLoras?: { path: string; scale?: number }[];
  lowNoiseLoras?: { path: string; scale?: number }[];
}

// ─── Result ───────────────────────────────────────────────

export interface VideoGenerationResult {
  videoUrl: string;
  durationSeconds: number;
  hasAudio: boolean;
  provider: string;
  model: string;
  requestId: string | null;
  submittedAt: string;
  completedAt: string;
  providerInput?: Record<string, unknown>;   // exact body sent, when the provider builds it from a manifest
}

// ─── Provider Interface ───────────────────────────────────

export interface VideoProvider {
  name: string;
  supportedModels: string[];
  generate(
    model: string,
    request: VideoGenerationRequest,
    callbacks: {
      onProgress?: (stage: string) => void;
      onRequestId?: (requestId: string, provider: string) => void;
    }
  ): Promise<VideoGenerationResult>;
}

// ─── Model Constants ──────────────────────────────────────

export const VIDEO_MODELS = {
  KLING_V3: 'kling_v3',
  KLING_O3: 'kling_o3',
  KLING_MOTION: 'kling_2.6_motion',
  SEEDANCE_1_5: 'seedance_1.5',
  SEEDANCE_2_0: 'seedance_2.0',
  SEEDANCE_2_5: 'seedance_2.5',
  VEO_3_1: 'veo_3.1',
  GEMINI_OMNI_FLASH: 'gemini_omni_flash',
  WAN_2_2: 'wan_2.2',
  WAN_ANIMATE: 'wan_2.2_animate',
} as const;

export type VideoModelId = typeof VIDEO_MODELS[keyof typeof VIDEO_MODELS];

export const VIDEO_MODEL_NAMES: Record<VideoModelId, string> = {
  [VIDEO_MODELS.KLING_V3]: 'Kling v3.0 Pro',
  [VIDEO_MODELS.KLING_O3]: 'Kling O3 Omni',
  [VIDEO_MODELS.KLING_MOTION]: 'Kling 2.6 Motion',
  [VIDEO_MODELS.SEEDANCE_1_5]: 'Seedance 1.5 Pro',
  [VIDEO_MODELS.SEEDANCE_2_0]: 'Seedance 2.0',
  [VIDEO_MODELS.SEEDANCE_2_5]: 'Seedance 2.5',
  [VIDEO_MODELS.VEO_3_1]: 'Veo 3.1',
  [VIDEO_MODELS.GEMINI_OMNI_FLASH]: 'Gemini Omni Flash',
  [VIDEO_MODELS.WAN_2_2]: 'Wan 2.2 (LoRA)',
  [VIDEO_MODELS.WAN_ANIMATE]: 'Wan 2.2 Animate',
};
