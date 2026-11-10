# Endpoint audit (2026-11-05, evening)

Every provider endpoint in `dashboard/lib` and `dashboard/app/api`, checked against the live model page.
Rule: before wiring or changing any endpoint, open its page and look for a deprecation banner. Add the row here.

| Endpoint | Provider | Used by | Status | Note |
|---|---|---|---|---|
| fal-ai/flux-2-trainer-v2 | fal | Character train | LIVE | $0.0064/step |
| fal-ai/flux-2/lora | fal | Character text | LIVE | |
| fal-ai/flux-2/lora/edit | fal | Character scene replication | LIVE | up to 4 reference images |
| fal-ai/qwen-image-trainer-v2 | fal | (removed from UI) | **DEPRECATED** | accepts jobs, never runs. v1 died here |
| fal-ai/qwen-image, qwen-image-edit-plus-lora | fal | (unused, kept for type) | not re-checked | do not use |
| fal-ai/nano-banana-2/edit | fal | provider fallback | LIVE | |
| fal-ai/kling-video/v3/pro/image-to-video | fal | video fallback | LIVE | |
| fal-ai/kling-video/v2.6/pro/motion-control | fal | video fallback | LIVE | $0.112/s |
| fal-ai/bytedance/seedream/v4.5/edit | fal | provider fallback | LIVE | $0.04/img |
| fal-ai/bytedance/seedance/v1.5/pro/image-to-video | fal | video fallback | LIVE | |
| google/nano-banana-2.1/edit | wavespeed | Generate, deidentify | LIVE | $0.036-0.04/img |
| bytedance/seedream-v5.0-lite/edit-sequential | wavespeed | Generate | LIVE | $0.035/img |
| bytedance/seedance-2.5/image-to-video | wavespeed | Video | LIVE | $0.36/s at 720p |
| kwaivgi/kling-video-o3-pro/image-to-video | wavespeed | Video | LIVE | $0.112/s, +25% sound. Page points at Kling V4.0 as newer |
| google/gemini-omni-flash/image-to-video | wavespeed | Video | LIVE (preview) | "newer version available": Gemini Omni 1.1 Flash |
| google/veo3.1-fast/image-to-video | wavespeed | Video | LIVE | $0.15/s |
| kwaivgi/kling-lipsync/audio-to-video | wavespeed | Ads | LIVE | $0.03/s, 3 s min |
| kwaivgi/kling-v2.6-pro/motion-control | wavespeed | Video, Create > copy video | LIVE | $0.112/s |
| nano-banana-2, nano-banana-pro, seedream v4/v4.5, seedance 1.5/2.0, kling v3.0, image-upscaler | wavespeed | pre-existing (April) | not re-checked tonight | worked in April; check before relying on them |

Follow-ups spotted: Kling V4.0 image-to-video and Gemini Omni 1.1 Flash exist on Wavespeed and are not wired.
| wavespeed-ai/z-image-turbo/image-to-image-lora | wavespeed | Character scene (Z-Image) | LIVE (page read 2026-11-06) | $0.01/img; `image`, `prompt`, `loras[{path,scale}]`, `strength` 0-1 (default 0.6) |
| fal-ai/z-image-trainer | fal | Character train (Z-Image) | LIVE (api read 2026-11-06) | `image_data_url`, steps, lr 1e-4, `training_type` content/style/balanced; output `diffusers_lora_file` |
| fal-ai/z-image/turbo/lora | fal | Character text (Z-Image) | LIVE (api read 2026-11-06) | 8 steps, no guidance field, loras up to 3 (URL or HF repo) |
| blackforestlabs/flux-3/klein/base/trainer, .../text-to-image/lora, .../edit-image/lora | fal | Character (Klein) | LIVE (api read 2026-11-05) | `images_data_url`, `trigger_phrase`, `resolution`; output `lora_file`; edit takes up to 10 refs |

## Manifests (2026-11-06 afternoon)

Every image endpoint the app calls now has a manifest in `dashboard/lib/models/<slug>.json` (fal: the endpoint's own OpenAPI, fetched 2026-11-06; WaveSpeed: transcribed from the docs page the same day, `source` field in each file). `lib/models/manifest.ts` normalizes them; every request body is built by `buildInput()` from that manifest and the exact body is stored (`provider_input` on generations, remixes, carousels, characters). UI chips come from the same manifest (`components/ModelSettings.tsx`), so a chip that is not a real field of the endpoint cannot exist.

| Endpoint | Provider | Manifest source | Exposed in UI |
|---|---|---|---|
| fal-ai/z-image/turbo/lora | fal | OpenAPI | acceleration, enable_prompt_expansion, num_inference_steps, enable_safety_checker |
| fal-ai/flux-2/lora, /lora/edit | fal | OpenAPI | guidance_scale, num_inference_steps, acceleration, enable_safety_checker |
| blackforestlabs/flux-3/klein/base/text-to-image/lora, /edit-image/lora | fal | OpenAPI | guidance_scale, num_inference_steps, enable_prompt_expansion, enable_safety_checker |
| fal-ai/nano-banana-2/edit, nano-banana-pro/edit | fal | OpenAPI | resolution (0.5K-4K), aspect_ratio, safety_tolerance, thinking_level, enable_web_search, enable_image_search |
| fal-ai/bytedance/seedream/v4.5/edit, v4/edit | fal | OpenAPI | enable_safety_checker (+ enhance_prompt_mode on v4) |
| fal-ai/z-image-trainer, flux-2-trainer-v2, blackforestlabs/flux-3/klein/base/trainer | fal | OpenAPI | steps, learning_rate, training_type / output_lora_format / resolution |
| google/nano-banana-2.1/edit, 2/edit, pro/edit | wavespeed | docs page | resolution, aspect_ratio, enable_web_search, enable_image_search (2.1 and 2 only) |
| bytedance/seedream-v5.0-lite, v4.5, v4 /edit-sequential | wavespeed | docs page | nothing user-facing (size, max_images are app-managed) |
| wavespeed-ai/z-image-turbo/image-to-image-lora | wavespeed | docs page | strength, size |

Which endpoint a tab's chips describe follows `app_settings.primary_provider` (Settings tab). It is **fal** right now, so Create/Copy/Remix chips are fal's.

## 2026-11-09
| Endpoint | Provider | Used by | Status | Note |
|---|---|---|---|---|
| wavespeed-ai/wan-2.2/i2v-720p-lora | wavespeed | Video tab: Wan 2.2 (LoRA) | LIVE (docs page read 2026-11-09), not yet run from the app | $0.35 per 5 s, $0.56 for 8 s. `image`, `prompt`, `duration` 5/8, `last_image`, `loras` / `high_noise_loras` / `low_noise_loras` (max 3 each, scale 0-4). No audio, no aspect field (follows the image). |
| fal-ai/wan/v2.2-a14b/image-to-video/lora | fal | not wired | LIVE (llms.txt read 2026-11-09) | $0.10/s. More knobs (steps, guidance x2, shift, fps, interpolation). Alternative if WaveSpeed quality disappoints. |
