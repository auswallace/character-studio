// lib/models/endpoints.ts  (client-safe)
// App model id -> provider endpoint id whose manifest (lib/models/<slug>.json) describes its fields.
// The router picks the primary provider from Settings (app_settings.primary_provider); /api/models?model=<id>
// resolves the endpoint for that provider, so the chips come from the endpoint that will actually be hit.
export const MODEL_ENDPOINTS: Record<'wavespeed' | 'fal', Record<string, string>> = {
  wavespeed: {
    nanobanana:     'google/nano-banana-pro/edit',
    nanobanana2:    'google/nano-banana-2/edit',
    nanobanana21:   'google/nano-banana-2.1/edit',
    seedream50lite: 'bytedance/seedream-v5.0-lite/edit-sequential',
    seedream45:     'bytedance/seedream-v4.5/edit-sequential',
    seedream40:     'bytedance/seedream-v4/edit-sequential',
  },
  // fal has no 2.1 / 5.0 Lite endpoints verified; the router sends those to Nano Banana 2 / Seedream 4.5 (lib/providers/router.ts MODEL_EQUIVALENTS).
  fal: {
    nanobanana:     'fal-ai/nano-banana-pro/edit',
    nanobanana2:    'fal-ai/nano-banana-2/edit',
    nanobanana21:   'fal-ai/nano-banana-2/edit',
    seedream50lite: 'fal-ai/bytedance/seedream/v4.5/edit',
    seedream45:     'fal-ai/bytedance/seedream/v4.5/edit',
    seedream40:     'fal-ai/bytedance/seedream/v4/edit',
  },
};
