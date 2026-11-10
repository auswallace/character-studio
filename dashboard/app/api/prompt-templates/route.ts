import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { invalidateTemplateCache, TEMPLATE_KEYS } from '@/lib/prompt-templates';

// ─── Default Templates ──────────────────────────────────────────
// These are the canonical defaults. The DB table starts empty;
// any key without a row falls back to these.

const SEEDREAM_GUIDANCE = `MODEL-SPECIFIC GUIDANCE (Seedream):
- Seedream uses priority-weighted parsing — concepts mentioned FIRST get the most emphasis. Front-load: Subject + Action first, then Outfit, then Setting, then Lighting, then Camera, then Style.
- Camera section: Use lens terminology — "85mm lens", "50mm f/1.8", "shallow depth of field", "smooth bokeh". Do NOT use device names like "iPhone" or "GoPro".
- Keep the total scene description between 60 and 250 words. Be concise — pick 3-5 powerful quality descriptors, not 20 weak ones.
- Do NOT stack repetitive quality terms (e.g., "ultra-detailed" + "hyper-detailed" causes artifacts).
- NEVER use these words (they trigger AI beautification in Seedream): perfect, flawless, stunning, masterpiece, ultra-detailed, 8k, hyper-realistic, professional photoshoot, cinematic lighting, dramatic, vibrant colors, beauty shot, magazine quality, glamorous, breathtaking, ethereal.
- End with a single style anchor: "candid snapshot", "lifestyle photography", or "editorial portrait".`;

const NANOBANANA_PRO_GUIDANCE = `MODEL-SPECIFIC GUIDANCE (Nanobanana):
- Camera section: Use consumer device names instead of lens specs — "shot on iPhone 15 Pro front camera", "Samsung Galaxy S24 selfie", "GoPro wide-angle". Include device-specific behavior like "slight wide-angle distortion" when appropriate.
- Write in natural narrative sentences as if briefing a photographer on set. Avoid comma-separated keyword lists.
- Frame ALL descriptions positively — describe what IS present, never what is absent. Say "empty background wall" not "no people in background".
- Include small authenticity details: objects on surfaces (water bottles, phone chargers, tangled earbuds), clothing imperfections (wrinkled fabric, worn-in sneakers, faded graphics), and natural skin ("natural skin texture with visible pores, unretouched").
- You MAY reference color grading or film stock style if it enhances the scene mood (e.g., "warm analog tones", "slightly desaturated palette", "muted natural colors") but do NOT override the lighting source or direction described from the reference image.
- NEVER use: perfect, flawless, stunning, masterpiece, ultra-detailed, 8k, hyper-realistic, professional photoshoot, cinematic lighting, dramatic, vibrant colors, beauty shot, magazine quality, glamorous.`;

const NANOBANANA_2_GUIDANCE = NANOBANANA_PRO_GUIDANCE;

// ─── Preambles (read-only, shown in UI for awareness) ────────────
// These are the reference image routing instructions prepended to every
// final prompt. They tell Wavespeed which images are face/body/scene refs.
// They are NOT editable — changing them breaks the image-to-ref mapping.

const PREAMBLES: Record<'generate' | 'remix', { label: string; description: string; content: string; step: number }> = {
  generate: {
    label: 'Reference Image Routing',
    description: 'Hardcoded preamble prepended to every generate prompt before it reaches Wavespeed. Maps the 4 reference images: images 1-2 = face structure, image 3 = body/physique, image 4 = the scene reference. This is baked into the Vision Prompt output format and preserved through all optimization steps.',
    content: 'Use the first two reference images for the face structure. Use reference image 3 for the body type and physique. Use reference image 4 as the complete reference for clothing, pose, action, scene composition, background environment, lighting setup, and overall atmosphere.',
    step: 2,
  },
  remix: {
    label: 'Reference Image Routing',
    description: 'Hardcoded preamble prepended to remix prompts (when enhance is ON). Two variants: (1) With face refs \u2014 for attribute, background, and removal edits (Nanobanana only: 2 face + source). (2) Source-only \u2014 for pose/expression edits or Seedream models (1 image: source only, face refs dropped).',
    content: 'WITH FACE REFS (attribute/background/removal, Nanobanana only):\nUse the first two reference images for the face structure and identity. Use the last reference image as the source \u2014 match its clothing, pose, scene composition, background environment, lighting setup, and overall atmosphere while applying only the requested changes.\n\nSOURCE ONLY (pose/expression or Seedream):\nUse this reference image as the source \u2014 match its clothing, scene composition, background environment, lighting setup, and overall atmosphere while applying only the requested changes.',
    step: 2,
  },
};

const DEFAULTS: Record<
  string,
  { label: string; description: string; content: string; route: 'generate' | 'remix' | 'caption' | 'carousel'; step: number }
> = {
  [TEMPLATE_KEYS.GENERATE_VISION]: {
    label: 'Vision Analysis',
    description: 'Step 1 of 3 \u2014 Sent to Grok/Gemini Vision along with the reference image. The AI analyzes the image and outputs a complete scene description (clothing, pose, lighting, setting). This output feeds into the JSON structurer or keyword optimizer. Controls what the AI describes (clothing, pose) and what it ignores (facial features, tattoos).',
    route: 'generate',
    step: 1,
    content: `You are an expert at creating complete image generation prompts for Seedream 4.5 AI model.

IMPORTANT CONTEXT:
- Seedream will receive 4 reference images in this order:
  1. Images 1-2: Face structure references
  2. Image 3: Body type and physique reference
  3. Image 4: THIS image - complete scene reference
- You are analyzing image 4 ONLY
- Your output must be a COMPLETE prompt for Seedream

YOUR TASK:
Analyze this image and create a complete Seedream prompt that instructs the AI how to use all references and describes everything visible in THIS image.

OUTPUT FORMAT (mandatory structure):

"Use the first two reference images for the face structure. Use reference image 3 for the body type and physique. Use reference image 4 as the complete reference for clothing, pose, action, scene composition, background environment, lighting setup, and overall atmosphere.

Subject details: [Describe the person's clothing in complete detail - every garment, accessories, jewelry, shoes, specific details like patterns, textures, colors, cuts, styles]. [Describe the exact pose - standing, sitting, body position, arm placement, leg position]. [Describe what the person is doing - their action, gesture, body language, facial expression like smiling/serious but WITHOUT describing facial features].

The scene: [describe location type and setting]. The environment features [describe architectural elements, furniture, props, and background in detail]. The setting is [indoor/outdoor details with spatial relationships].

Lighting: [describe light source, direction, quality, shadows, time of day, color temperature in technical detail].

Camera: [describe angle, perspective, depth of field, focal distance, composition].

Atmosphere: [describe mood, ambiance, weather if applicable, environmental effects].

Colors and textures: [describe dominant colors throughout the scene, materials, surface properties, color palette].

Technical quality: [high-resolution, sharp focus, professional photography, etc.]."

CRITICAL RULES:
- DO describe: clothing (every detail), pose, action, body language, gesture, expression type (smile/serious)
- NEVER describe: hair color, hair style, eye color, facial features, skin tone, ethnic features
- NEVER mention tattoos, body art, piercings, birthmarks, or scars from the reference image — even if clearly visible, omit them entirely. The generated model should have clean, unmarked skin.
- Use "this person", "the subject" when referring to the individual
- Be extremely detailed about clothing and accessories
- Be precise about pose and body position
- Focus on EVERYTHING visible except facial/hair features and body markings

Output ONLY the formatted prompt, nothing else.`,
  },

  [TEMPLATE_KEYS.GENERATE_KEYWORDS_SEEDREAM]: {
    label: 'Seedream 4.5 — Model Guidance',
    description: 'Appended to the vision template when Seedream is selected. Coaches Grok on Seedream-specific prompt structure: front-loading, lens terminology, word count, and banned words.',
    route: 'generate',
    step: 3,
    content: SEEDREAM_GUIDANCE,
  },

  [TEMPLATE_KEYS.GENERATE_KEYWORDS_NANO_PRO]: {
    label: 'Nanobanana Pro — Model Guidance',
    description: 'Appended to the vision template when Nanobanana Pro is selected. Coaches Grok on Nanobanana-specific prompt style: device names, positive framing, authenticity details, film stock references.',
    route: 'generate',
    step: 3,
    content: NANOBANANA_PRO_GUIDANCE,
  },

  [TEMPLATE_KEYS.GENERATE_KEYWORDS_NANO_2]: {
    label: 'Nanobanana 2 — Model Guidance',
    description: 'Appended to the vision template when Nanobanana 2 is selected. Same guidance as Nanobanana Pro.',
    route: 'generate',
    step: 3,
    content: NANOBANANA_2_GUIDANCE,
  },

  [TEMPLATE_KEYS.REMIX_VISION]: {
    label: 'Vision Analysis',
    description: 'Sent to Grok/Gemini Vision with the hero image. The AI describes the full scene then applies the requested edit. Use {REMIX_PROMPT} as the placeholder for the user\'s remix instruction.',
    route: 'remix',
    step: 1,
    content: `You are an expert AI image generation prompt engineer specializing in targeted image edits.

Look at the attached image carefully. Describe the full scene in detail \u2014 the person (face, body type, hair, expression), their clothing, pose, background, lighting, and camera angle.

Then apply ONLY this change: "{REMIX_PROMPT}"

Be extremely specific about what stays the same and what changes. Include: "professional photography, high resolution, detailed, sharp focus"

Output ONLY the enhanced prompt text. No explanations, no quotes, no prefixes.`,
  },

  [TEMPLATE_KEYS.CAPTION_INSTRUCTIONS_SOFI]: {
    label: 'Sofi Belle \u2014 Voice & Style',
    description: 'Injected into the Grok caption prompt when generating captions for Sofi Belle. Controls her tone, vocabulary, emoji usage, and brand voice. Leave empty to use the default caption format with no persona customization.',
    route: 'caption',
    step: 1,
    content: '',
  },

  [TEMPLATE_KEYS.CAPTION_INSTRUCTIONS_SAMANTHA]: {
    label: 'Samantha Bell \u2014 Voice & Style',
    description: 'Injected into the Grok caption prompt when generating captions for Samantha Bell. Controls her tone, vocabulary, emoji usage, and brand voice. Leave empty to use the default caption format with no persona customization.',
    route: 'caption',
    step: 1,
    content: '',
  },

  [TEMPLATE_KEYS.CAROUSEL_ANGLE_LEFT]: {
    label: '30° Left Angle',
    description: 'Carousel prompt: shifts camera approximately 30 degrees to the left of the original viewpoint, natural pose adjustment.',
    route: 'carousel',
    step: 1,
    content: `Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but shift the camera position approximately 30 degrees to the left of the original viewpoint. Keep the same distance from the subject and the same framing. The person's pose should adjust naturally to the new camera angle as it would in a real photo taken seconds apart. Maintain natural skin texture, the same ambient lighting direction, and all background elements. Candid snapshot, same moment different angle`,
  },

  [TEMPLATE_KEYS.CAROUSEL_CLOSEUP]: {
    label: 'Medium Close-Up',
    description: 'Carousel prompt: moves camera closer for chest-up framing, slightly above eye level, shallow depth of field.',
    route: 'carousel',
    step: 1,
    content: `Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but move the camera closer to the subject for a medium close-up framing from chest up, positioned slightly above eye level looking down at a subtle angle. The subject should appear to glance up naturally toward the camera. Keep the same background visible but now with shallow depth of field softly blurring it. Maintain all environmental details, same ambient light source and direction. Shot on iPhone 15 Pro, casual portrait moment`,
  },

  [TEMPLATE_KEYS.CAROUSEL_WIDE]: {
    label: 'Wide Environmental',
    description: 'Carousel prompt: pulls camera back for full-body environmental shot revealing more surrounding space.',
    route: 'carousel',
    step: 1,
    content: `Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but pull the camera back to a wider full-body environmental shot, showing more of the surrounding space. The subject should appear naturally within the broader scene at roughly the same position. Reveal more of the floor, ceiling or sky, and background context that would logically exist beyond the original frame. Keep the same lighting conditions and atmosphere. Slight wide-angle perspective as if taken on a smartphone rear camera stepped back a few meters`,
  },

  [TEMPLATE_KEYS.CAROUSEL_OVER_SHOULDER]: {
    label: 'Over-the-Shoulder',
    description: 'Carousel prompt: repositions camera 120 degrees around subject for three-quarter rear view with glance back.',
    route: 'carousel',
    step: 1,
    content: `Refer to Image 1 as the foundational reference. Preserve the exact same person, outfit, environment, lighting, and mood. Recreate this exact scene but reposition the camera approximately 120 degrees around the subject to capture a three-quarter rear view. The person is glancing back over their shoulder toward where the original camera was, with a natural relaxed expression. Show the back of their outfit and hair while keeping their face partially visible in profile. The same environment and lighting should be visible from this new perspective. Candid over-the-shoulder moment`,
  },
};

// ─── GET — list all templates (DB rows merged with defaults) ────
export async function GET() {
  try {
    const { data: rows, error } = await supabase
      .from('prompt_templates')
      .select('key, content, updated_at');

    if (error) {
      console.error('[prompt-templates] GET error:', error.message);
      // Fall through — we still return defaults for every key
    }

    const dbMap = new Map<string, { content: string; updatedAt: string }>();
    if (rows) {
      for (const row of rows) {
        dbMap.set(row.key, { content: row.content, updatedAt: row.updated_at });
      }
    }

    const templates = Object.entries(DEFAULTS).map(([key, def]) => {
      const dbRow = dbMap.get(key);
      return {
        key,
        label: def.label,
        description: def.description,
        route: def.route,
        step: def.step,
        content: dbRow ? dbRow.content : def.content,
        source: dbRow ? ('custom' as const) : ('default' as const),
        updatedAt: dbRow ? dbRow.updatedAt : null,
      };
    });

    return NextResponse.json({ templates, preambles: PREAMBLES });
  } catch (err) {
    console.error('[prompt-templates] GET unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Helper: log a version snapshot ─────────────────────────────
async function logTemplateVersion(templateKey: string, content: string, changeSummary?: string) {
  try {
    // Get the latest version number for this key
    const { data: latest } = await supabase
      .from('prompt_template_versions')
      .select('version')
      .eq('template_key', templateKey)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (latest?.version || 0) + 1;

    await supabase
      .from('prompt_template_versions')
      .insert({
        template_key: templateKey,
        content,
        version: nextVersion,
        change_summary: changeSummary || null,
      });

    return nextVersion;
  } catch (err) {
    // Best effort — don't fail the main operation if versioning fails
    console.error('[prompt-templates] Version log failed:', err);
    return null;
  }
}

// ─── PUT — upsert a template ────────────────────────────────────
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, content, changeSummary } = body as { key?: string; content?: string; changeSummary?: string };

    if (!key || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Missing required fields: key (string), content (string)' },
        { status: 400 }
      );
    }

    if (!DEFAULTS[key]) {
      return NextResponse.json(
        { error: `Invalid template key: ${key}` },
        { status: 400 }
      );
    }

    // Snapshot the current content before overwriting
    const { data: existing } = await supabase
      .from('prompt_templates')
      .select('content')
      .eq('key', key)
      .single();

    const previousContent = existing?.content || DEFAULTS[key].content;

    // Only log a version if the content actually changed
    let version: number | null = null;
    if (previousContent !== content) {
      version = await logTemplateVersion(key, content, changeSummary);
    }

    const { data, error } = await supabase
      .from('prompt_templates')
      .upsert({ key, content, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select()
      .single();

    if (error) {
      console.error('[prompt-templates] PUT error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    invalidateTemplateCache(key);

    return NextResponse.json({ template: data, version });
  } catch (err) {
    console.error('[prompt-templates] PUT unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── DELETE — reset a template to default ───────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { key } = body as { key?: string };

    if (!key) {
      return NextResponse.json(
        { error: 'Missing required field: key (string)' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('prompt_templates')
      .delete()
      .eq('key', key);

    if (error) {
      console.error('[prompt-templates] DELETE error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    invalidateTemplateCache(key);

    return NextResponse.json({ success: true, key });
  } catch (err) {
    console.error('[prompt-templates] DELETE unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
