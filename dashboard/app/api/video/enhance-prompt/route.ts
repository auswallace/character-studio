import { NextRequest, NextResponse } from 'next/server';
import { apiKeys, GROK_TEXT_MODEL } from '@/lib/supabase';

// ─── POST — Enhance video prompt via Grok ────────────────
//
// Takes a user's rough prompt and the target video model,
// returns an optimized prompt following that model's best practices.

const MODEL_PROMPT_GUIDES: Record<string, string> = {
  kling_v3: `You are optimizing a prompt for Kling v3.0 image-to-video generation.

Structure the prompt as: [Shot type] + [Subject + action/movement] + [Environment] + [Camera movement] + [Lighting/mood] + [Style]

Key tips:
- Be specific about motion: "slowly turns", "hair catches wind", "gestures with right hand"
- Include camera direction: "slight pan left", "static shot", "slow zoom in"
- Mention lighting: "soft morning light", "golden hour", "studio lighting"
- Keep under 2500 characters
- End with style keywords: "cinematic", "photorealistic", "professional"`,

  'kling_2.6_motion': `You are optimizing a prompt for Kling 2.6 Motion Control. The motion comes from a reference video — the prompt is ONLY for scene refinement.

Keep the prompt SHORT and focused on:
- Lighting description (e.g., "warm golden hour lighting")
- Atmosphere/mood (e.g., "dreamy, ethereal feel")
- Color grading (e.g., "cinematic color grading, warm tones")
- Background details if needed

Do NOT describe character actions or motion — that comes from the reference video.`,

  'seedance_1.5': `You are optimizing a prompt for Seedance 1.5 Pro with native audio generation.

Structure: Action + Dialogue + Ambient Sound + Camera + Style

Key tips:
- Put dialogue in quotes: says "Let me show you something"
- Describe ambient sound after "Ambient:": keyboard typing, office hum, birds
- Camera terms: "fixed camera", "slow pan left", "zoom in", "dolly forward"
- Include sound design for richer output
- Keep under 3000 characters`,

  'seedance_2.0': `You are optimizing a prompt for Seedance 2.0 — ByteDance's most advanced video model with cinematic output, native audio, real-world physics, and director-level camera control.

Structure: Scene + Character Action + Dialogue + Ambient Sound + Camera + Style

Key tips:
- Seedance 2.0 supports up to 15 seconds — design scenes with enough detail for longer clips
- Put dialogue in quotes: says "This changes everything"
- Describe ambient sound: birds chirping, city traffic, rain on windows, keyboard typing
- Camera: "smooth dolly in", "slow tracking shot", "fixed close-up", "arc around subject"
- Leverage physics: flowing hair, cloth movement, liquid splashes, particle effects
- Include sound design and music cues for richer audio output
- Multi-shot scenes: describe natural cuts between angles within one prompt
- Quality keywords: "cinematic", "professional lighting", "shallow depth of field"
- Keep under 3000 characters`,

  'seedance_2.5': `You are optimizing a prompt for Seedance 2.5 — ByteDance's long-form video model: single continuous shots up to 30 seconds, native synced audio, strong physics and character consistency.

Structure: Scene + Character Action(s) in time order + Dialogue + Ambient Sound + Camera + Style

Key tips:
- Up to 30 seconds in ONE shot — write actions in the order they happen, roughly one action per 3-5 seconds
- Plain sentences, not adjective lists. Seedance follows verbs better than adjectives
- Put dialogue in quotes: says "this is the one I actually use"
- Describe ambient sound after "Ambient:": room tone, footsteps, fabric, distant traffic
- Camera: "fixed camera", "slow push in", "tracks backward at her pace", "arcs around"
- If the user gives start and end frames, describe the transition between them, not two separate scenes
- Keep hands and held objects (phone, product) explicitly "steady" or the model drifts them
- Quality keywords: "natural skin texture", "no exaggeration", "realistic motion"
- Keep under 3000 characters`,

  'kling_o3': `You are optimizing a prompt for Kling O3 Omni — Kling's dialogue-first video model with native audio and lip sync, 3-15 seconds.

Structure: [Shot type] + [Subject + action] + [Dialogue in quotes] + [Camera] + [Lighting/style]

Key tips:
- Lead with the shot: "Medium shot:", "Close-up:", "Medium close-up, eye level:"
- Dialogue in quotes, and keep it short enough for the clip length (about 2.5 words per second)
- One or two actions max; the face and mouth are the focus, so keep body motion small
- Describe lighting in film terms: "soft key light", "window light from the left"
- End with "natural lip sync, photoreal"
- No on-screen text, no captions in the prompt
- Keep under 2500 characters`,

  'gemini_omni_flash': `You are optimizing a prompt for Gemini Omni Flash — Google's fast video model with synchronized audio, 3-10 seconds.

Everything goes in ONE cinematic paragraph: scene + subject action + dialogue in quotes + camera + light + ambient sound.

Key tips:
- Write it like a shot description a DP would read: lens feel, light direction, one camera move
- Dialogue in quotes, delivered naturally; describe tone ("warm, unhurried")
- Short clips (3-10s): one beat, one small gesture, one expression change
- Name the ambient bed explicitly: "Ambient: quiet room, soft footstep"
- Avoid stacked adjectives; one precise detail beats three vague ones
- Keep under 3000 characters`,

  'veo_3.1': `You are optimizing a prompt for Veo 3.1 — Google's cinematic video model with native audio.

EVERYTHING goes in one prompt block: scene + character actions + camera + dialogue + ambient sound + music.

Key tips:
- Describe the full scene cinematically
- Include dialogue in quotes
- Describe ambient sound: "quiet office atmosphere, distant city sounds"
- Include music direction: "subtle piano", "uplifting modern score"
- Camera direction: "slow zoom in", "tracking shot", "shallow depth of field"
- Veo excels at cinematic quality — use film language
- Keep under 3000 characters`,
};

export async function POST(request: NextRequest) {
  try {
    const { prompt, model } = await request.json();

    if (!prompt || !model) {
      return NextResponse.json({ error: 'prompt and model are required' }, { status: 400 });
    }

    const grokKey = apiKeys.grok;
    if (!grokKey) {
      return NextResponse.json({ error: 'Grok API key not configured' }, { status: 500 });
    }

    const guide = MODEL_PROMPT_GUIDES[model] || MODEL_PROMPT_GUIDES['kling_v3'];

    const systemPrompt = `${guide}

Your task: Take the user's rough prompt and rewrite it into an optimized version following the structure above.

Rules:
- PRESERVE the user's intent and core idea — don't change what they want to create
- ADD missing elements (camera, lighting, style, sound) that the user didn't specify
- Make it more specific and detailed
- Output ONLY the enhanced prompt, nothing else — no explanations, no preamble
- Do NOT wrap in quotes`;

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grokKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Grok API error ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const enhanced = data.choices?.[0]?.message?.content?.trim();

    if (!enhanced) {
      throw new Error('Grok returned empty response');
    }

    console.log(`[video/enhance-prompt] Enhanced prompt for ${model} (${prompt.length} → ${enhanced.length} chars)`);

    return NextResponse.json({ enhanced });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[video/enhance-prompt] Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
