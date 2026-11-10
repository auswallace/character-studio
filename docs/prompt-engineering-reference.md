# Prompt Engineering Reference

A living reference doc for how to get the best results from each model in our pipeline. Updated as we learn what works.

---

## Kling 2.6 Motion Control

### What It Is
Multimodal AI model that takes a reference image (character) + motion reference video (action) and fuses them. Extracts skeletal movement, gestures, expressions, and pacing from the video and applies to your static character while maintaining identity. Digital puppeteer.

### Required Inputs
1. **Character Image** — the person/character to animate
2. **Motion Reference Video** — video containing the movement to replicate (3-30 seconds)
3. **Text Prompt** (optional) — for environment/style guidance ONLY, NOT for describing motion

### Workflow
1. Upload character image
2. Upload reference video (3-30 seconds)
3. Choose Character Orientation mode:
   - **Image Orientation** — Preserves image pose/direction, adopts camera movements from video. Max 10s. Best for camera moves (pans, tilts, tracking).
   - **Video Orientation** — Transfers both motion AND spatial orientation from video. Max 30s. Best for dance, athletic movements, complex choreography.
4. Add prompt focused on environment and style (NOT motion)
5. Generate

### Reference Image Preparation
- All limbs must be visible — if hands are in pockets but motion requires waving, AI hallucinates (6-finger glitches, blurry textures)
- Leave breathing room / negative space — subject needs frame space to move without clipping
- High-quality, well-lit images with clear subjects
- Full-body images for full-body movement
- Front-facing images improve expression accuracy

### Reference Video Selection
- Simplicity is king — clear subject, clean background
- High-contrast videos where actor's silhouette is distinct
- Avoid: extremely fast movements, multiple scene changes, shaky camera, partial occlusions
- Sweet spot: 3-6 seconds for tight control, up to 30s for complex sequences
- Pre-stabilize shaky footage before uploading
- Match framing: close-up reference for face work, full-body reference for body motion

### Prompting Strategy
The reference video already defines the motion. Prompt should focus ONLY on:

1. **Environment/Background:** "Place the character in a modern office with glass walls, soft daylight"
2. **Lighting:** "Cinematic lighting, neon city, golden hour"
3. **Style/Finish:** "High-quality commercial quality, 4k resolution, film grain"

**NEVER describe motion in prompts** — redundant and causes conflicts.

#### Good Prompt Example
```
Style the character as a confident marketing spokesperson wearing modern business attire, placed in a clean virtual studio with soft lighting and shallow depth of field, cinematic realism, professional commercial quality.
```

### Technical Tips
- Match aspect ratios between image and video (both 16:9 or both 9:16)
- If motion reference is landscape and final is portrait, pre-crop to center subject
- Use negative prompts to lock camera: "no camera shake, no zoom, no handheld wobble, no micro-jitter"
- Start with 4-6 second clips — longer clips invite drift
- Test at low resolution/draft mode first to catch issues quickly

### Common Problems & Fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| 6-fingered hands / blurry textures | Limbs hidden in source image | Use image with visible limbs |
| Face warping mid-gesture | Face occlusion in reference | Pick cleaner takes, shorten to clean beats |
| Elbows/feet cut off | Aspect ratio mismatch | Match aspect ratios; set 9:16 from start |
| Shaking/warped face | Scale mismatch (full-body ref + portrait image) | Match framing between reference and image |
| Everything jitters | Unstable reference video | Pre-stabilize the reference in editor |
| Camera drifting | Prompt conflicts with motion | Remove "dynamic camera pans/zooms", keep camera locked |
| Weird artifacts (extra fingers, melting) | Over-prompted | Strip adjectives, let motion do the work |
| Motion feels "floaty" | Over-eager model | Add explicit constraints, use shorter clips |
| Limb drift / wrong part moving | Ambiguous instructions | Name smallest moving joint first: "Right wrist flick, fingers lead, shoulder stays neutral" |

---

## Nanobanana Pro

### What It Is
Multi-reference image compositor (actually **Google Gemini 3 Pro Image** under the hood). A "thinking" model that understands photography physics, intent, and composition natively. Takes face references + body references + scene prompt and generates a new image maintaining face/body identity.

### Our Configuration
- Default 2K resolution (2160x2700) — 4K available but slower / timeout risk
- Max 4 images per request
- Used for SFW content (Seedream 4.5 for spicier)

### Reference Image Setup
- 2 face reference images + 2 body reference images + optional 1 prompt image (scene/pose reference)
- Face refs should be clear, well-lit, different angles if possible
- Body refs should show full figure with consistent body type

### Key Notes
- Google embeds SynthID invisible watermarks + C2PA metadata — our pipeline scrubs these via JPEG re-encode before posting
- Images at Instagram's 4:5 ratio by default
- Nanobanana Pro supports up to 8 reference images (vs 4 for original Nano Banana)

### Prompt Style
- **Natural language** — brief a photographer, don't use comma-separated tags
- Provide intent/use case (e.g. "editorial portrait for high-end fashion magazine") and the model infers DOF, lighting, etc.
- Optimal prompt length: 30-100 words

### Model-Specific Keywords (Photorealism Boosters)
These are the keywords Nanobanana Pro responds to best, from official Wavespeed and Google documentation.

**Skin & Face (highest impact for our personas):**
- `natural skin texture`, `visible pores and natural micro-details`
- `dewy fresh complexion`, `finely rendered eyelashes with crisp catchlight`
- `calibrated color grading`, `perfectly accurate skin tones`
- `realistic eye reflections`, `natural hair texture`

**Lighting (single biggest quality factor):**
- `golden hour backlighting` — warm, natural
- `Rembrandt lighting` — sculptural, high-contrast
- `three-point lighting` — professional depth
- `soft natural fill light plus strong golden rim light`
- `practical lighting` — visible light sources in scene
- `volumetric lighting`

**Camera/Lens (second biggest factor):**
- `85mm lens at f/1.8` — best for portrait bokeh
- `50mm lens` — balanced, editorial
- `shot on full-frame cinema camera` — forces photorealistic film grain
- `shallow depth of field`

**Color Grading:**
- `warm color grading with lifted blacks`
- `cinematic teal-and-orange color grade`
- `muted warm tones`
- `calibrated color grading`

**Quality:**
- `editorial cover quality`, `photorealistic`, `cinematic`
- `4K detail`, `ultra-sharp focus`, `professional-grade`

**Negative prompts:** Keep to 3-5 items max (Wavespeed recommendation). Long SD-style negative lists hurt quality.
Core negatives: `low quality, blurry, watermark, bad anatomy, extra fingers, cartoonish, plastic skin`

### Sources
- [Wavespeed: 15 Nano Banana Pro Tips](https://wavespeed.ai/blog/posts/nano-banana-pro-tips-tricks-better-results/)
- [Wavespeed: Complete Guide 2026](https://wavespeed.ai/blog/posts/google-nano-banana-pro-complete-guide-2026/)
- [Wavespeed: 4K Settings Guide](https://wavespeed.ai/blog/posts/blog-nano-banana-pro-4k-output-settings/)
- [Google Official: 7 Tips](https://blog.google/products/gemini/prompting-tips-nano-banana-pro/)
- [dev.to Google AI Prompting Guide](https://dev.to/googleai/nano-banana-pro-prompting-guide-strategies-1h9n)

---

## Seedream 4.5

### What It Is
Multi-reference image compositor by ByteDance. More flexible content policy than Nanobanana. Uses **priority-weighted prompt parsing** — concepts mentioned first get more emphasis.

### Our Configuration
- Min 2560x1440 total pixels (auto-enforced)
- Default size: 2048x2560 (4:5 portrait)
- Max 6 images per request
- Used for content that needs more creative freedom

### Reference Image Setup
Same as Nanobanana: 2 face + 2 body + optional prompt image

### Key Notes
- Higher min resolution requirement than Nanobanana
- Seedream 5.0 is NOT the upgrade for photorealism — Wavespeed docs say "for pure visual beauty and photorealism, Seedream 4.5 remains the recommended choice." 5.0 prioritizes reasoning over aesthetics.
- Wavespeed API does NOT expose negative_prompt parameter — use in-prompt negation instead

### Prompt Style
- **Priority ordering matters** — most important concepts FIRST
- Structure: `Subject + Action → Style → Composition → Lighting → Technical`
- **Natural language** over tag lists
- Optimal prompt length: 30-100 words (beyond 100 creates conflicts)

### Model-Specific Keywords (Photorealism Boosters)
These fix Seedream's tendency toward flat lighting and fake-looking faces. From official BytePlus docs, fal.ai guide, and Wavespeed tutorials.

**Skin & Face (fixes the fake-face problem):**
- `natural skin texture` — primary recommendation across all sources
- `3D face contour` — specifically adds face depth/dimensionality
- `catchlights in eyes` — makes faces look alive
- `crisp details`, `subtle makeup`
- `clean skin texture`
- WARNING: Do NOT stack `ultra-detailed` multiple times — causes "crunchy pores"

**Lighting (fixes flat lighting — Seedream is "particularly responsive to lighting cues"):**
- `soft window light with gentle shadow falloff` — top portrait recommendation
- `dramatic side lighting with soft fill` — adds dimensionality
- `golden hour lighting` — warm, directional, most natural
- `three-point lighting` — professional depth
- `softbox key light from left, gentle shadow falloff` — highly specific, tested
- `soft key light, catchlights in eyes` — face dimensionality
- `cinematic backlighting` — rim light effect
- KEY: Avoid mixing multiple unrelated lighting sources. Pick one setup and describe it precisely.

**Camera/Lens:**
- `85mm lens, f/1.8` — most recommended for portraits
- `50mm lens` — natural, editorial
- `shallow depth of field`, `smooth bokeh background`

**Quality:**
- `photorealistic`, `crisp details`, `professional`
- `sharp focus`, `4K detail`
- Pick 3-5 powerful descriptors, not 20 weak ones

**In-prompt negation (since no negative_prompt API param):**
- `not cartoon-like, no watermarks, no extra limbs, no text`

### Common Mistakes
1. Conflicting style instructions ("photorealistic cartoon character")
2. Keyword stacking (`ultra-detailed, hyper-detailed, super-detailed` degrades quality)
3. Prompts beyond 100 words create confusion
4. Mixing multiple unrelated lighting sources
5. Using old Stable Diffusion negative prompt lists — hurt newer models
6. Ignoring prompt order — most important elements MUST come first

### Sources
- [BytePlus Official Seedream 4.0-4.5 Prompt Guide](https://docs.byteplus.com/en/docs/ModelArk/1829186)
- [fal.ai Seedream v4.5 Prompt Guide](https://fal.ai/learn/devs/seedream-v4-5-prompt-guide)
- [Wavespeed: Seedream 4.5 Complete Guide](https://wavespeed.ai/blog/posts/seedream-4-5-complete-guide-2026/)
- [Wavespeed: Seedream 4.0-5.0 Tutorial](https://wavespeed.ai/blog/posts/seedream-4-0-to-5-0-complete-tutorial-image-generation-editing/)
- [CopyRocket Seedream 4.5 Prompting Guide](https://copyrocket.ai/seedream-4-5-prompting-guide/)
- [Segmind Seedream 4 Prompt Guide](https://blog.segmind.com/mastering-seedream-prompt-engineering-guide/)

---

## Veo 3.1

### What It Is
Video generation model. Takes a text prompt and generates video.

### Best Practices
*To be filled in as we build the video pipeline*

---

## General Prompting Principles

### For Image Generation
- Physical attributes of the subject should be injected via Model_Traits (automatic in our pipeline)
- NEVER mention tattoos, body art, piercings, birthmarks, or scars — even if visible in references
- Prompt_Note field on Generation records provides per-prompt creative direction
- Keep prompts descriptive but concise — describe what you see, not abstract concepts

### For Video Generation
- Keep prompts short and focused (2-3 sentences max — video models work better with shorter prompts)
- Describe the scene and action clearly
- Avoid overly complex multi-step actions in a single prompt

### For Captions (AI-Generated)
- See `docs/ig-strategy-klembord4.md` for full Instagram caption strategy
- Never mention subscription platforms by name
- No hashtags (dead for reach)
- No emojis
- X/Twitter: questions that drive replies
- Instagram: short, flirty, specific to the image
- Threads: conversational inner-monologue style
