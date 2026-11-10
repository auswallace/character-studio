import { NextRequest, NextResponse } from 'next/server';
import { assertSpendAllowed, SpendCapError } from '@/lib/spend-guard';
import { scoreRecordInBackground } from '@/lib/scorer';
import { imageCost } from '@/lib/pricing';
import { supabase, apiKeys, GROK_VISION_MODEL, GROK_TEXT_MODEL } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { stripImageMetadata } from '@/lib/strip-metadata';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/prompt-templates';
import { getProviderRouter, MODEL_NAMES, WavespeedGenerationResult, aspectRatioToSize } from '@/lib/providers';
import { activeCharacterFor, generateWithCharacterGated, characterCanEdit, characterReferenceStills, isWavespeedEdit } from '@/lib/characters/active';
import { INFERENCE } from '@/lib/characters/fal';


// ─── Types ────────────────────────────────────────────────

interface PersonaRef {
  id: string;
  persona_id: string;
  ref_type: 'face' | 'body';
  slot: number;
  storage_path: string;
  url: string;
  filename: string;
}

interface PersonaRow {
  id: string;
  name: string;
  active_character_id?: string | null;
  traits: string | null;
  api_provider: string | null;
  prompt_provider: string | null;
  enable_nsfw: boolean | null;
  num_images: number | null;
  persona_refs: PersonaRef[];
}

interface GenerationRow {
  id: string;
  name: string | null;
  persona: string | null;
  persona_id: string | null;
  image_model: string | null;
  prompt: string | null;
  prompt_note: string | null;
  prompt_image_url: string | null;
  error_message: string | null;
  starred: boolean | null;
  drive_synced: boolean | null;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────

/** Write an SSE event to a stream controller */
function sseEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  data: Record<string, unknown>,
) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

/** Get the next auto-incremented name for a persona (e.g., sofi_0017) */
async function getNextName(personaName: string): Promise<string> {
  const prefix = personaName.split(' ')[0].toLowerCase(); // "Sofi Belle" → "sofi"

  // Fetch all matching records and find max number in code
  // (sort by Name is unreliable with mixed case: Samantha_123 vs samantha_001)
  const { data: records } = await supabase
    .from('generations')
    .select('name')
    .ilike('name', `${prefix}_%`)
    .limit(200);

  const regex = new RegExp(`^${prefix}_(\\d+)`, 'i');
  let maxNum = 0;
  for (const r of records || []) {
    const name = r.name || '';
    const match = name.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `${prefix}_${String(maxNum + 1).padStart(4, '0')}`;
}

// ─── Model Guidance Mapping ─────────────────────────────────
// Maps model names to their guidance template keys. These guidance blocks
// are appended to the vision template so Grok writes model-appropriate output
// in a single pass (no second API call).
function getModelGuidanceKey(modelName: string): string | null {
  const lower = modelName.toLowerCase();
  if (lower.includes('seedream')) return TEMPLATE_KEYS.GENERATE_KEYWORDS_SEEDREAM;
  if (lower.includes('nanobanana pro') || lower.includes('nanobanana_pro')) return TEMPLATE_KEYS.GENERATE_KEYWORDS_NANO_PRO;
  if (lower.includes('nanobanana 2') || lower.includes('nanobanana_2')) return TEMPLATE_KEYS.GENERATE_KEYWORDS_NANO_2;
  return null;
}

// ─── Prompt Template (matches batch-processor.js) ─────────

const VISION_PROMPT_TEMPLATE = `You are an expert at creating complete image generation prompts for Seedream 4.5 AI model.

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

Camera: [describe shot type (medium shot, close-up, full-body), lens or device, depth of field, composition].

Atmosphere and colors: [mood, ambiance, dominant colors, materials, surface textures — keep brief].

Style: [one or two style anchor words — e.g., candid snapshot, lifestyle photography, editorial portrait, casual photo]."

CRITICAL RULES:
- DO describe: clothing (every detail), pose, action, body language, gesture, expression type (smile/serious)
- NEVER describe: hair color, hair style, eye color, facial features, skin tone, ethnic features
- NEVER mention tattoos, body art, piercings, birthmarks, or scars from the reference image — even if clearly visible, omit them entirely. The generated model should have clean, unmarked skin.
- Use "this person", "the subject" when referring to the individual
- Be extremely detailed about clothing and accessories
- Be precise about pose and body position
- Focus on EVERYTHING visible except facial/hair features and body markings
- Write in flowing descriptive sentences, not comma-separated keyword lists
- Front-load the most important visual details: subject action and pose FIRST, then outfit, then setting, then lighting, then camera, then style

Output ONLY the formatted prompt, nothing else.`;

// ─── Prompt Generation (Vision + Text modes) ─────────────

/**
 * Vision mode: Send the prompt image to Grok/Gemini vision API with the
 * batch-processor prompt template. The LLM SEES the image and describes
 * exactly what's in it — clothing, pose, scene, lighting.
 */
async function analyzeImageWithGrok(
  imageBase64: string,
  mimeType: string,
  promptTemplate: string,
): Promise<string> {
  const grokKey = apiKeys.grok;
  if (!grokKey) throw new Error('Grok API key not configured');

  const dataUri = `data:${mimeType};base64,${imageBase64}`;

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${grokKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROK_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUri } },
            { type: 'text', text: promptTemplate },
          ],
        },
      ],
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Grok Vision API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Grok Vision returned no content');
  return text.trim();
}

async function analyzeImageWithGemini(
  imageBase64: string,
  mimeType: string,
  promptTemplate: string,
): Promise<string> {
  const geminiKey = apiKeys.gemini;
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': geminiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
              { text: promptTemplate },
            ],
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini Vision API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini Vision returned no content');
  return text.trim();
}

/**
 * Text-only mode (no prompt image): Use Grok/Gemini to generate a prompt
 * from just the text description + traits. Simpler template since there's
 * no image to analyze.
 */
async function generateTextPromptWithGrok(
  traits: string,
  notes: string,
  enableNSFW: boolean,
  modelName?: string,
): Promise<string> {
  const grokKey = apiKeys.grok;
  if (!grokKey) throw new Error('Grok API key not configured');

  let prompt = buildTextOnlyTemplate(traits, notes, enableNSFW);

  // Append model-specific guidance
  if (modelName) {
    const guidanceKey = getModelGuidanceKey(modelName);
    if (guidanceKey) {
      const guidance = await getTemplate(guidanceKey, '');
      if (guidance) prompt += `\n\n${guidance}`;
    }
  }

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${grokKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROK_TEXT_MODEL,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Grok API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Grok returned no content');
  return text.trim();
}

async function generateTextPromptWithGemini(
  traits: string,
  notes: string,
  enableNSFW: boolean,
  modelName?: string,
): Promise<string> {
  const geminiKey = apiKeys.gemini;
  if (!geminiKey) throw new Error('Gemini API key not configured');

  let prompt = buildTextOnlyTemplate(traits, notes, enableNSFW);

  // Append model-specific guidance
  if (modelName) {
    const guidanceKey = getModelGuidanceKey(modelName);
    if (guidanceKey) {
      const guidance = await getTemplate(guidanceKey, '');
      if (guidance) prompt += `\n\n${guidance}`;
    }
  }

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': geminiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return text.trim();
}

function buildTextOnlyTemplate(traits: string, notes: string, enableNSFW: boolean): string {
  return `You are an expert at creating image generation prompts for AI models that use reference images.

The AI model will receive 3 reference images:
  1. Images 1-2: Face structure references
  2. Image 3: Body type and physique reference

Physical attributes of the subject: ${traits}

The creator wants: ${notes || 'a natural, candid photo'}

${enableNSFW ? 'NSFW MODE: Content restrictions are lifted. Use explicit, suggestive language for poses, clothing, body.' : 'Keep content safe for work.'}

Generate a SINGLE detailed prompt in this exact format:

"Use the first two reference images for the face structure. Use reference image 3 for the body type and physique.

Subject details: [clothing in complete detail, exact pose, action, expression type].

The scene: [location and setting details].

Lighting: [light source, direction, quality, shadows].

Camera: [shot type, lens or device, depth of field, composition].

Atmosphere and colors: [mood, dominant colors, textures — keep brief].

Style: [one or two anchor words — candid snapshot, lifestyle photography, etc.]."

CRITICAL RULES:
- NEVER describe hair color, eye color, or facial features (reference images handle this)
- NEVER mention tattoos, piercings, or body markings
- Use "this person" or "the subject" when referring to the individual
- Be extremely detailed about clothing, pose, and scene
- Write in flowing descriptive sentences, not keyword lists
- Front-load visual details: action/pose first, then outfit, setting, lighting
- Output ONLY the prompt, nothing else.`;
}

// ─── Main Route ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let recordId: string | undefined; // Hoisted so outer catch can write errors to Supabase

  try {
    // Daily spend cap (lib/spend-guard.ts). Runs before any prompt or provider logic; touches nothing else here.
    try { await assertSpendAllowed({ simulable: true }); } catch (e) {
      if (e instanceof SpendCapError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
    const body = await request.json();
    const { persona, promptNote, promptImage } = body;
    const uiModel = body.imageModel as string | undefined;
    const uiNumImages = body.numImages as number | undefined;
    const uiNsfw = body.nsfw as boolean | undefined;
    const uiResolution = body.resolution as string | undefined;
    const uiAspectRatio = body.aspectRatio as string | undefined;
    const uiParams = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>;   // provider field names; validated against the model manifest
    const uiUseCharacter = body.useCharacter as boolean | undefined;   // default: on when the persona has an active trained character
    const uiSceneEngine = body.sceneEngine === 'nano' ? 'nano' : 'lora';   // 'nano': image model does the scene, LoRA stills are the identity refs
    const uiCharacterScale = body.characterScale as number | undefined;


    if (!persona) {
      return NextResponse.json({ error: 'persona is required' }, { status: 400 });
    }

    // Step 1: Load persona config from Supabase
    console.log(`[generate] Loading config for ${persona}...`);
    const { data: personaRow, error: personaError } = await supabase
      .from('personas')
      .select('*, persona_refs(*)')
      .eq('name', persona)
      .single<PersonaRow>();

    if (personaError || !personaRow) {
      return NextResponse.json({ error: `Persona "${persona}" not found` }, { status: 404 });
    }

    // Get permanent Supabase Storage URLs for reference images.
    // We pass URLs directly to Wavespeed (not base64 data URIs) to stay under the 30MB payload limit.
    const faceRefs = (personaRow.persona_refs || [])
      .filter((r: PersonaRef) => r.ref_type === 'face')
      .sort((a: PersonaRef, b: PersonaRef) => a.slot - b.slot)
      .slice(0, 2)
      .map((r: PersonaRef) => r.url);
    const bodyRefs = (personaRow.persona_refs || [])
      .filter((r: PersonaRef) => r.ref_type === 'body')
      .sort((a: PersonaRef, b: PersonaRef) => a.slot - b.slot)
      .slice(0, 1)
      .map((r: PersonaRef) => r.url);
    console.log(`[generate] Fetched refs: ${faceRefs.length} face, ${bodyRefs.length} body`);
    let character = uiUseCharacter === false ? null : await activeCharacterFor(personaRow.id, (typeof body.characterId === 'string' && body.characterId) || personaRow.active_character_id);   // characterId: a specific trained version picked in the model menu
    let characterStills: string[] = [];
    if (character && uiSceneEngine === 'nano') {
      // Hybrid: the image model renders the scene; her best-scoring LoRA stills replace the reference photos.
      characterStills = await characterReferenceStills(character, 3);
      console.log(`[generate] hybrid: ${uiModel || 'default model'} scene + ${characterStills.length} LoRA stills from ${character.name}`);
      character = null;
    } else if (character && promptImage && !characterCanEdit(character)) {
      // Prompt image + text-only base: the LoRA cannot take a scene, so fall back to the reference path with her LoRA stills as the face refs.
      characterStills = await characterReferenceStills(character, 2);
      console.log(`[generate] ${character.name} is text-only; prompt image given -> reference path with ${characterStills.length} LoRA stills`);
      character = null;
    }
    if (character) console.log(`[generate] Using trained character ${character.name} (${character.base_model})`);
    const traits = personaRow.traits || '';
    // Normalize model ID → display name (UI sends 'nanobanana2', route logic uses 'Nanobanana 2')
    // MODEL_NAMES imported from @/lib/providers
    const rawModel = uiModel || 'nanobanana2';
    const imageModel = MODEL_NAMES[rawModel] || rawModel;
    const enableNSFW = uiNsfw ?? false; // NSFW controlled only from Image Copy toggle, not persona settings

    let numImages = uiNumImages || personaRow.num_images || 2;
    const imageSize = aspectRatioToSize(uiAspectRatio || '9:16');
    if (imageModel === 'Seedream 5.0 Lite' || imageModel === 'Seedream 4.5' || imageModel === 'Seedream 4.0') {
      if (numImages > 6) numImages = 6;
    } else {
      if (numImages > 4) numImages = 4;
    }

    const promptProvider = personaRow.prompt_provider || 'Grok';
    console.log(`[generate] Settings: ${imageModel}, ${numImages} images, ${imageSize}, NSFW=${enableNSFW}, prompt=${promptProvider}`);

    // Step 2: Create Supabase Generation record
    const autoName = await getNextName(persona);
    const { data: genRecord, error: genError } = await supabase
      .from('generations')
      .insert({
        name: autoName,
        persona: persona,
        persona_id: personaRow.id,
        // Label what actually rendered: the LoRA version, or the image model plus the LoRA stills it was given (hybrid).
        image_model: character ? character.name : (uiSceneEngine === 'nano' && characterStills.length ? `${imageModel} + LoRA stills` : imageModel),
        character_id: character?.id || null,
        prompt_note: promptNote || null,
      })
      .select()
      .single<GenerationRow>();

    if (genError || !genRecord) {
      return NextResponse.json({ error: `Failed to create generation: ${genError?.message || 'unknown'}` }, { status: 500 });
    }
    recordId = genRecord.id;
    console.log(`[generate] Created ${autoName} (${recordId})`);

    // Step 3: Build reference images [face1, face2, body]
    const refImages = characterStills.length ? characterStills : [...faceRefs.slice(0, 2), ...bodyRefs.slice(0, 1)];

    // Step 4: Generate prompt — two modes depending on whether prompt image exists
    let prompt: string;
    const hasPromptImage = !!promptImage;
    let sceneRef: string | null = null;   // the prompt image as a URL (or data URI) a provider can load; promptImage itself is bare base64

    if (hasPromptImage) {
      // ═══ VISION MODE ═══
      // Like batch-processor: send the image to Grok/Gemini vision with the
      // full prompt template. The LLM SEES the image and describes what's in it.
      console.log(`[generate] Vision mode: analyzing prompt image with ${promptProvider}...`);

      // Build the final template with injections (matching batch-processor)
      // Resolve from DB (Settings > Prompt Editor) or fall back to hardcoded default
      let finalTemplate = await getTemplate(TEMPLATE_KEYS.GENERATE_VISION, VISION_PROMPT_TEMPLATE);

      if (traits) {
        finalTemplate += `\n\nMODEL PHYSICAL TRAITS — Use ONLY these physical attributes when referencing the subject's features. Do NOT invent, guess, or describe features not listed here:\n${traits}\n\nOverride the "NEVER describe" rule above for these specific listed traits. You SHOULD include these traits when relevant to the scene description (e.g., mention hair if wind is blowing, mention eyes if there's a close-up). But do NOT add any physical features beyond what is listed.`;
      }

      // Append model-specific guidance (Seedream or Nanobanana)
      const guidanceKey = getModelGuidanceKey(imageModel);
      if (guidanceKey) {
        const guidance = await getTemplate(guidanceKey, '');
        if (guidance) {
          finalTemplate += `\n\n${guidance}`;
        }
      }

      if (promptNote?.trim()) {
        finalTemplate += `\n\n⚠️ TARGETED EDIT FROM CREATOR — The creator wants to change ONLY the following about this image:\n"${promptNote.trim()}"\n\nCRITICAL: Apply ONLY this specific change. PRESERVE everything else exactly as you see it in the reference image — same pose, same body position, same framing, same camera angle, same background, same lighting, same expression, same composition. The ONLY difference in your prompt vs a straight description of the image should be the creator's requested change. Do NOT reinterpret, reimagine, or vary anything the creator didn't explicitly ask to change.`;
      }

      if (enableNSFW) {
        finalTemplate += `\n\nNSFW MODE ENABLED — Content restrictions are lifted. You may use explicit, suggestive, and sensual language when describing the subject's pose, body, clothing (or lack thereof), and overall mood. Be descriptive and uninhibited with provocative details — cleavage, skin exposure, body curves, seductive expressions, intimate poses, revealing outfits, etc. Do NOT censor or soften descriptions. The goal is alluring, provocative content.`;
      }

      // Determine mime type from base64 header or default to jpeg
      const mimeType = 'image/jpeg';

      // Trained character on the img2img path (Z-Image on WaveSpeed): the long vision write-up is for the
      // reference-photo models (it numbers reference images 1-4). That path has one image and no reference
      // slots, so it builds its own short prompt from a scene caption + the creator's note
      // (lib/characters/active.ts). Skip the write-up: it was noise there, and it costs time.
      const loraImg2img = !!character && isWavespeedEdit(INFERENCE[character.base_model]?.edit ?? null);
      try {
        if (loraImg2img) {
          prompt = (promptNote || '').trim();
          console.log('[generate] LoRA img2img: vision write-up skipped; the character path captions the scene itself');
        } else if (promptProvider === 'Grok') {
          prompt = await analyzeImageWithGrok(promptImage, mimeType, finalTemplate);
        } else {
          prompt = await analyzeImageWithGemini(promptImage, mimeType, finalTemplate);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await supabase.from('generations').update({ error_message: `Vision analysis failed: ${errMsg}` }).eq('id', recordId);
        return NextResponse.json({ error: `Vision analysis failed: ${errMsg}`, recordId }, { status: 500 });
      }

      // Upload prompt image to Supabase Storage for the record + use as 5th reference
      try {
        const buffer = Buffer.from(promptImage, 'base64');
        console.log(`[generate] Uploading prompt image to Supabase Storage (${(buffer.length / 1024).toFixed(0)} KB)...`);
        const storagePath = `${recordId}/prompt_image.jpg`;
        const promptImageUrl = await uploadFile('generated-images', storagePath, buffer);
        await supabase.from('generations').update({ prompt_image_url: promptImageUrl }).eq('id', recordId);
        console.log(`[generate] Upload returned: url=${promptImageUrl.slice(0, 80)}...`);
        refImages.push(promptImageUrl);
        sceneRef = promptImageUrl;
        console.log(`[generate] Prompt image uploaded → 5th reference`);
      } catch (err) {
        // Non-fatal: use data URI as fallback for 5th reference
        console.warn(`[generate] Supabase upload issue: ${err instanceof Error ? err.message : err}`);
        // Pass as full data URI — Wavespeed accepts these
        refImages.push(`data:image/jpeg;base64,${promptImage}`);
        sceneRef = `data:image/jpeg;base64,${promptImage}`;
        console.log(`[generate] Using data URI as 5th reference (fallback, ${(promptImage.length / 1024).toFixed(0)} KB)`);
      }

    } else {
      // ═══ TEXT-ONLY MODE ═══
      // Like batch-processor text-only: prepend traits, or use LLM to enhance
      console.log(`[generate] Text mode: generating prompt via ${promptProvider}...`);

      try {
        if (promptProvider === 'Grok') {
          prompt = await generateTextPromptWithGrok(traits, promptNote || '', enableNSFW, imageModel);
        } else {
          prompt = await generateTextPromptWithGemini(traits, promptNote || '', enableNSFW, imageModel);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await supabase.from('generations').update({ error_message: `Prompt generation failed: ${errMsg}` }).eq('id', recordId);
        return NextResponse.json({ error: `Prompt generation failed: ${errMsg}`, recordId }, { status: 500 });
      }
    }

    // Save full prompt (with preamble) to record for debugging
    await supabase.from('generations').update({ prompt }).eq('id', recordId);
    console.log(`[generate] Prompt ready (${prompt.length} chars, ${hasPromptImage ? 'vision' : 'text'} mode)`);

    const validRefs = refImages.filter(Boolean);
    console.log(`[generate] Reference images: ${refImages.length} total, ${validRefs.length} valid`);
    console.log(`[generate] Ref URLs: ${validRefs.map((u, i) => `[${i + 1}] ${u.startsWith('data:') ? 'data:...' : u.slice(0, 70)}`).join(' | ')}`);

    // Step 5: Generate images via ProviderRouter
    // The router handles model → provider routing, Nanobanana vs Seedream differences,
    // retries, polling, and fallback — all abstracted behind a single generate() call.
    const router = getProviderRouter();

    // Strip reference image preamble before sending to Wavespeed/FAL.
    // The preamble ("Use the first two reference images...") is meta-instruction
    // that the diffusion model cannot interpret — it wastes high-priority tokens.
    // Full prompt (with preamble) is already saved to DB for debugging.
    let wavespeedPrompt = prompt;
    const preambleEnd = prompt.indexOf('\n\nSubject details:');
    if (preambleEnd !== -1) {
      wavespeedPrompt = prompt.substring(preambleEnd + 2);
    }

    const stream = new ReadableStream({
      async start(controller) {
        const rid = recordId!; // recordId is guaranteed set by this point (Supabase record created above)
        try {
          sseEvent(controller, 'progress', { stage: 'Starting image generation...', recordId: rid, name: autoName });

          const allImageUrls: { url: string; index: number }[] = [];
          const gateScores = new Map<string, number>();   // trained-character gate scores, saved with the image

          let result: WavespeedGenerationResult | { provider: string; requestId?: string; submittedAt?: string; completedAt?: string };
          if (character) {
            // Trained character: identity comes from the LoRA, so no reference photos are sent.
            // A prompt image becomes the scene to replicate (pose, framing, setting) with her in it.
            const t0 = new Date().toISOString();
            const cg = await generateWithCharacterGated(character, personaRow.id, {
              prompt: wavespeedPrompt, numImages, aspectRatio: uiAspectRatio || '9:16', scale: uiCharacterScale,
              sceneUrl: hasPromptImage ? sceneRef : null,
              onProgress: (stage) => { try { sseEvent(controller, 'progress', { stage }); } catch { /* client disconnected */ } },
            });
            cg.images.forEach((im, index) => {
              allImageUrls.push({ url: im.url, index });
              if (im.score != null) gateScores.set(im.url, im.score);
              try { sseEvent(controller, 'image', { index, url: im.url, total: numImages, score: im.score, rerolled: im.rerolled }); } catch { /* client disconnected */ }
            });
            if (cg.rerolls) { try { sseEvent(controller, 'progress', { stage: `${cg.rerolls} image${cg.rerolls === 1 ? '' : 's'} rerolled for a better face match` }); } catch { /* client disconnected */ } }
            try { await supabase.from('generations').update({ prompt: cg.prompt, cost_usd: cg.costUsd, cost_source: 'rate_card', image_model: character.name }).eq('id', rid); } catch { /* best effort */ }
            result = { provider: cg.model.startsWith('wavespeed:') ? cg.model : `fal:${cg.model}`, submittedAt: t0, completedAt: new Date().toISOString() };
          } else {
            result = await router.generate(imageModel, {
              prompt: wavespeedPrompt,
              images: validRefs,
              numImages,
              imageSize,
              aspectRatio: uiAspectRatio || '9:16',
              resolution: uiResolution || '2k',
              params: uiParams,
            }, (url, index) => {
              allImageUrls.push({ url, index });
              try { sseEvent(controller, 'image', { index, url, total: numImages }); }
              catch { /* client disconnected */ }
            }, (stage) => {
              try { sseEvent(controller, 'progress', { stage }); }
              catch { /* client disconnected */ }
            });
          }

          // Save which provider was used (for Browse tab metadata)
          try { await supabase.from('generations').update({ provider: result.provider, ...(('providerInput' in result && result.providerInput) ? { provider_input: { endpoint: result.endpoint, ...result.providerInput } } : {}) }).eq('id', rid); } catch { /* best effort */ }

          // Post-process: strip metadata + save to Supabase
          try { sseEvent(controller, 'progress', { stage: 'Saving images...' }); }
          catch { /* client disconnected */ }

          // Get per-image metadata if available (Nanobanana provides per-image request IDs)
          const wsResult = result as WavespeedGenerationResult;
          const perImageResults = wsResult.perImageResults;

          console.log(`[generate] Stripping metadata from ${allImageUrls.length} images...`);
          await Promise.allSettled(allImageUrls.map(async ({ url: imgUrl, index: i }) => {
            try {
              const cleanBuffer = await stripImageMetadata(imgUrl);
              console.log(`[generate] Image ${i + 1}/${allImageUrls.length} metadata stripped (${(cleanBuffer.length / 1024).toFixed(0)} KB)`);
              const storagePath = `${rid}/image_${i + 1}.jpg`;
              const publicUrl = await uploadFile('generated-images', storagePath, cleanBuffer);

              // Per-image audit metadata (wavespeed_request_id, submitted_at, completed_at)
              const imgMeta = perImageResults?.[i];

              await supabase.from('generation_images').insert({
                generation_id: rid,
                storage_path: storagePath,
                url: publicUrl,
                filename: `image_${i + 1}.jpg`,
                size: cleanBuffer.length,
                sort_order: i,
                wavespeed_request_id: imgMeta?.wavespeedRequestId || result.requestId,
                submitted_at: imgMeta?.submittedAt || result.submittedAt,
                completed_at: imgMeta?.completedAt || result.completedAt,
                ...(gateScores.has(imgUrl) ? { consistency_score: gateScores.get(imgUrl), scored_at: new Date().toISOString() } : {}),
              });
            } catch (uploadErr) {
              console.error(`[generate] Failed to strip/upload image ${i + 1}, falling back to URL:`, uploadErr);
              // Fallback: save raw URL
              await supabase.from('generation_images').insert({
                generation_id: rid,
                url: imgUrl,
                filename: `image_${i + 1}.jpg`,
                sort_order: i,
                wavespeed_request_id: result.requestId,
                submitted_at: result.submittedAt,
                completed_at: result.completedAt,
              });
            }
          }));

          const imageCount = allImageUrls.length;
          const failedCount = numImages - imageCount;

          // Record partial failure so it shows in the UI
          if (failedCount > 0 && imageCount > 0) {
            await supabase.from('generations').update({
              error_message: `${failedCount} of ${numImages} images failed to generate`,
            }).eq('id', rid);
          }

          if (imageCount === 0) {
            await supabase.from('generations').update({
              error_message: 'All image generation requests failed',
            }).eq('id', rid);
          }

          const elapsedNum = (Date.now() - startTime) / 1000;
          const elapsed = elapsedNum.toFixed(1);
          console.log(`[generate] Done! ${autoName}: ${imageCount} images in ${elapsed}s`);

          // Persist duration
          try { await supabase.from('generations').update({ duration_seconds: elapsedNum }).eq('id', rid); } catch { /* best effort */ }
          if (!character) { try { const est = result.provider === 'simulate' ? { costUsd: 0, source: 'simulate' } : imageCost(imageModel, imageCount); await supabase.from('generations').update({ cost_usd: est.costUsd, cost_source: est.source }).eq('id', rid); } catch { /* best effort */ } }
          // Face-consistency score (scripts/scorer). Fire-and-forget; no-op without SCORER_URL.
          if (imageCount > 0) scoreRecordInBackground('generation', rid);

          try {
            sseEvent(controller, 'done', {
              success: imageCount > 0,
              recordId: rid,
              name: autoName,
              imageCount,
              requestedCount: numImages,
              failedCount,
              elapsed: `${elapsed}s`,
            });
          } catch { /* client disconnected — images already saved to Supabase */ }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[generate] SSE stream error:', errMsg);
          try { sseEvent(controller, 'error', { message: `Image generation failed: ${errMsg}`, fatal: true }); }
          catch { /* client disconnected */ }
          try {
            await supabase.from('generations').update({ error_message: `Image generation failed: ${errMsg}`, duration_seconds: (Date.now() - startTime) / 1000 }).eq('id', rid);
          } catch { /* best effort */ }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[generate] Unhandled error:', errMsg);
    // Write error to Supabase so the record doesn't appear stuck forever
    if (recordId) {
      try {
        await supabase.from('generations').update({
          error_message: `Unhandled error: ${errMsg}`,
        }).eq('id', recordId);
      } catch { /* best effort — don't mask the original error */ }
    }
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
