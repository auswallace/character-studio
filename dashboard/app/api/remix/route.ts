import { NextRequest, NextResponse } from 'next/server';
import { assertSpendAllowed, SpendCapError } from '@/lib/spend-guard';
import { scoreRecordInBackground } from '@/lib/scorer';
import { safeFetch } from '@/lib/safe-url';
import { supabase, apiKeys, GROK_VISION_MODEL } from '@/lib/supabase';
import { uploadFile } from '@/lib/storage';
import { fetchImageAsJpeg } from '@/lib/fetch-image';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/prompt-templates';
import { getProviderRouter, MODEL_NAMES, WavespeedGenerationResult, aspectRatioToSize, calculateAspectRatio } from '@/lib/providers';
import { activeCharacterFor, generateWithCharacter, characterCanEdit, characterReferenceStills, type ActiveCharacter , isWavespeedEdit } from '@/lib/characters/active';
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

/** Get the next auto-incremented remix name (e.g., samantha_remix_0003) */
async function getNextRemixName(personaName: string): Promise<string> {
  const prefix = personaName.split(' ')[0].toLowerCase(); // "Samantha Bell" → "samantha"
  const remixPrefix = `${prefix}_remix`;

  const { data: records } = await supabase
    .from('remixes')
    .select('name')
    .ilike('name', `${remixPrefix}_%`);

  const regex = new RegExp(`^${remixPrefix}_(\\d+)`, 'i');
  let maxNum = 0;
  for (const r of (records || [])) {
    const name = r.name || '';
    const match = name.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `${remixPrefix}_${String(maxNum + 1).padStart(4, '0')}`;
}

// Model-specific keyword references removed — the optimizer pass was adding
// bloat (800+ tokens) and a second Grok call (~10-20s). The vision model's
// direct output is sent to Wavespeed as-is, matching the old fast pipeline.

// ─── Model sizes (matches image-remix.js) ─────────────────

const MODEL_DEFAULT_SIZES: Record<string, string> = {
  'Seedream 5.0 Lite': '1440x2560',
  'Seedream 4.5': '1440x2560',   // 9:16 portrait — Seedream uses raw pixel size
  'Seedream 4.0': '1440x2560',   // 9:16 portrait
  'Nanobanana Pro': '1440x2560', // 9:16 portrait — aspect_ratio derived from this
  'Nanobanana 2': '1440x2560',   // 9:16 portrait — aspect_ratio derived from this
  'Nanobanana 2.1': '1440x2560',
};

// ─── Remix Reference Image Preamble ──────────────────────
// NOTE: This preamble is saved to `enhanced_prompt` for debug/traceability only.
// It is STRIPPED before sending to Wavespeed because the image model has no
// concept of "reference images" — it just receives a flat images[] array.
// Images are sent as: [face1, face2, heroImage]
const REMIX_PREAMBLE =
  'Use this reference image as the source — match its clothing, scene composition, ' +
  'background environment, lighting setup, and overall atmosphere while applying only the requested changes.';

// ─── Edit Type Classification ─────────────────────────────
// Keyword matching on user's remixPrompt — no AI call, runs instantly.
// Determines image routing, vision template, and preamble strategy.
type EditType = 'attribute' | 'background' | 'pose_expression' | 'removal';

const EDIT_TYPE_PATTERNS: Array<{ type: EditType; keywords: RegExp }> = [
  {
    type: 'removal',
    keywords: /\b(remove|delete|take off|get rid of|without|no more|erase)\b/i,
  },
  {
    type: 'pose_expression',
    keywords: /\b(pose|expression|smile|smiling|laugh|laughing|look(ing)?|fac(e|ing)|stand(ing)?|sit(ting)?|peace sign|turn(ing)?|lean(ing)?|eyes?|grin|wink|pout|arms?|hand(s)?|crouch|kneel|wave|waving|throw(ing)?)\b/i,
  },
  {
    type: 'background',
    keywords: /\b(background|scene|setting|location|environment|room|outdoor|indoor|beach|city|studio|forest|mountain|street|park|apartment|office|pool|rooftop|sunset|sunrise)\b/i,
  },
  {
    type: 'attribute',
    keywords: /\b(color|shirt|dress|outfit|clothing|wearing|wear|change.*to|swap|replace|hair|hat|glasses|shoes|jewelry|necklace|earring|bracelet|purse|bag|accessory)\b/i,
  },
];

function classifyEditType(remixPrompt: string): EditType {
  for (const { type, keywords } of EDIT_TYPE_PATTERNS) {
    if (keywords.test(remixPrompt)) {
      return type;
    }
  }
  return 'attribute'; // safest default — full description
}

function getRemixPreamble(_editType: EditType): string {
  return REMIX_PREAMBLE;
}

// ─── Remix Vision Prompt Template ────────────────────────
// Single template used for ALL remix edit types. Editable via Settings > Prompt Editor.

const REMIX_VISION_TEMPLATE_DEFAULT = `You are an expert AI image generation prompt engineer specializing in targeted image edits.

Look at the attached image carefully. Describe the full scene in detail — the person (face, body type, hair, expression), their clothing, pose, background, lighting, and camera angle.

Then apply ONLY this change: "{REMIX_PROMPT}"

Be extremely specific about what stays the same and what changes. Include: "professional photography, high resolution, detailed, sharp focus"

Output ONLY the enhanced prompt text. No explanations, no quotes, no prefixes.`;

async function enhancePromptWithVision(
  heroImageUrl: string,
  remixPrompt: string,
  editType: EditType = 'attribute',
  promptProvider: string = 'Grok',
): Promise<string> {
  // Resolve from DB (Settings > Prompt Editor) or fall back to hardcoded default
  const resolvedTemplate = await getTemplate(TEMPLATE_KEYS.REMIX_VISION, REMIX_VISION_TEMPLATE_DEFAULT);
  const promptText = resolvedTemplate.replace('{REMIX_PROMPT}', remixPrompt);

  let base64Image: string;
  let mimeType: string;

  if (heroImageUrl.startsWith('data:')) {
    // Already a data URI — extract base64 directly (no fetch needed)
    const match = heroImageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URI for hero image');
    mimeType = match[1];
    base64Image = match[2];
  } else {
    // Download hero image as base64 for vision API
    const imgResp = await safeFetch(heroImageUrl, {
      purpose: 'hero image',
      signal: AbortSignal.timeout(60000),
    });
    if (!imgResp.ok) throw new Error(`Failed to download hero image: ${imgResp.status}`);

    const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
    base64Image = imgBuffer.toString('base64');
    mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
  }

  // Use configured prompt provider (matches generate route behavior)
  console.log(`[remix] Enhancing prompt with ${promptProvider}...`);

  if (promptProvider === 'Grok') {
    const grokKey = apiKeys.grok;
    if (!grokKey) throw new Error('Grok API key not configured');

    const dataUri = `data:${mimeType};base64,${base64Image}`;
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grokKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROK_VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUri } },
            { type: 'text', text: promptText },
          ],
        }],
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Grok Vision API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Grok Vision returned no content');
    console.log(`[remix] Grok enhanced: "${text.trim().substring(0, 120)}..."`);
    return text.trim();
  } else {
    // Gemini
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
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Image } },
              { text: promptText },
            ],
          }],
        }),
        signal: AbortSignal.timeout(60000),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Vision API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini Vision returned no content');
    console.log(`[remix] Gemini enhanced: "${text.trim().substring(0, 120)}..."`);
    return text.trim();
  }
}

/** Build Next.js image optimization thumbnails for a Supabase Storage URL */
function makeThumbnails(url: string) {
  if (!url) return null;
  const enc = encodeURIComponent(url);
  return {
    small: { url: `/_next/image?url=${enc}&w=64&q=70` },
    large: { url: `/_next/image?url=${enc}&w=640&q=75` },
    full: { url: `/_next/image?url=${enc}&w=1920&q=85` },
  };
}

// ─── GET: List remixes ────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const persona = searchParams.get('persona');
    const ids = searchParams.get('ids');

    let query = supabase
      .from('remixes')
      .select('*, remix_images(*)')
      .or('all_images_deleted.is.null,all_images_deleted.eq.false')
      .order('created_at', { ascending: false });

    // Recovery mode: fetch specific records by ID
    if (ids) {
      const idList = ids.split(',').filter(Boolean);
      query = query.in('id', idList);
    } else {
      query = query.limit(limit);
      if (persona) {
        query = query.eq('persona', persona);
      }
    }

    const { data: records, error } = await query;
    if (error) throw error;

    const remixes = (records || []).map(r => {
      const allImages = (r.remix_images || []) as Array<{
        url: string;
        filename: string;
        width: number | null;
        height: number | null;
        is_upscaled: boolean;
        sort_order: number | null;
      }>;

      const regularImages = allImages
        .filter(img => !img.is_upscaled)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      const upscaledImages = allImages
        .filter(img => img.is_upscaled)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      return {
        id: r.id,
        name: r.name || '',
        heroImage: r.hero_image_url || null,
        remixPrompt: r.remix_prompt || '',
        numImages: r.num_images || 3,
        imageModel: r.image_model || '',
        persona: r.persona || '',
        enhancePrompt: r.enhance_prompt ?? true,
        enhancedPrompt: r.enhanced_prompt || '',
        variants: regularImages.map(img => ({
          url: img.url,
          filename: img.filename,
          width: img.width,
          height: img.height,
          thumbnails: makeThumbnails(img.url),
        })),
        upscaledImages: upscaledImages.map(img => ({
          url: img.url,
          filename: img.filename,
          width: img.width,
          height: img.height,
          thumbnails: makeThumbnails(img.url),
        })),
        starred: r.starred || false,
        provider: r.provider || null,
        providerInput: r.provider_input || null,
        error: r.error_message || null,
        status: regularImages.length > 0
          ? 'done'
          : r.error_message
            ? 'error'
            : 'pending',
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({ remixes });
  } catch (error) {
    console.error('[api/remix] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch remixes' },
      { status: 500 }
    );
  }
}

// ─── POST: Create remix AND generate images inline ────────

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
    const { heroImageUrl, remixPrompt, persona, numImages, imageModel, enhancePrompt } = body;

    const uiResolution = body.resolution as string | undefined;
    const uiAspectRatio = body.aspectRatio as string | undefined;
    const uiParams = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>;   // provider field names; validated against the model manifest

    if (!heroImageUrl || !remixPrompt) {
      return NextResponse.json(
        { error: 'heroImageUrl and remixPrompt are required' },
        { status: 400 }
      );
    }

    // Normalize model ID → display name (UI sends 'nanobanana2', route logic uses 'Nanobanana 2')
    // MODEL_NAMES imported from @/lib/providers
    const rawModel = imageModel || 'seedream40';
    const model = MODEL_NAMES[rawModel] || rawModel;
    const isNanobanana = model === 'Nanobanana Pro' || model === 'Nanobanana 2' || model === 'Nanobanana 2.1';
    const count = Math.min(numImages || 3, isNanobanana ? 4 : 6);
    const size = uiAspectRatio ? aspectRatioToSize(uiAspectRatio) : (MODEL_DEFAULT_SIZES[model] || '1728x2304');

    console.log(`[remix] Starting: ${model}, ${count} images, ${size}, persona=${persona || 'none'}`);

    // Step 1: Create Supabase record with auto-incremented name
    const isDataUri = heroImageUrl.startsWith('data:');
    const autoName = persona ? await getNextRemixName(persona) : `REMIX_${Date.now()}`;

    // Look up persona_id and prompt_provider if persona name given
    let personaId: string | null = null;
    let promptProvider = 'Grok';
    if (persona) {
      const { data: personaRow } = await supabase
        .from('personas')
        .select('id, prompt_provider')
        .eq('name', persona)
        .single();
      if (personaRow) {
        personaId = personaRow.id;
        promptProvider = personaRow.prompt_provider || 'Grok';
      }
    }

    const insertData: Record<string, unknown> = {
      name: autoName,
      remix_prompt: remixPrompt,
      num_images: count,
      enhance_prompt: enhancePrompt ?? true,
      persona: persona || null,
      persona_id: personaId,
      image_model: model,
    };

    // If hero is a real URL (not data URI), save it directly
    if (!isDataUri) {
      insertData.hero_image_url = heroImageUrl;
    }

    const { data: record, error: createError } = await supabase
      .from('remixes')
      .insert(insertData)
      .select()
      .single();

    if (createError) throw createError;
    recordId = record.id;
    const recordName = record.name || autoName;
    console.log(`[remix] Created record ${recordName} (${recordId})`);

    // If hero image is a data URI (uploaded), upload it to Supabase Storage
    let resolvedHeroUrl = heroImageUrl;
    if (isDataUri) {
      try {
        const base64Data = heroImageUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`[remix] Uploading hero image to Supabase Storage (${(buffer.length / 1024).toFixed(0)} KB)...`);
        const heroPath = `${recordId}/hero.jpg`;
        const heroPublicUrl = await uploadFile('remix-images', heroPath, buffer);
        resolvedHeroUrl = heroPublicUrl;

        // Update the record with the hero image URL
        await supabase
          .from('remixes')
          .update({ hero_image_url: heroPublicUrl })
          .eq('id', recordId);

        console.log(`[remix] Hero image uploaded → ${heroPublicUrl.slice(0, 80)}...`);
      } catch (err) {
        console.warn(`[remix] Hero image upload failed: ${err instanceof Error ? err.message : err}`);
        // Continue — Wavespeed accepts data URIs, vision will use base64 directly
      }
    }

    // Step 2: Enhance prompt if requested
    let finalPrompt = remixPrompt;
    const editType = classifyEditType(remixPrompt);
    console.log(`[remix] Edit type: ${editType} (from: "${remixPrompt.substring(0, 60)}")`);
    if (enhancePrompt) {
      try {
        finalPrompt = await enhancePromptWithVision(resolvedHeroUrl, remixPrompt, editType, promptProvider);
        await supabase
          .from('remixes')
          .update({ enhanced_prompt: finalPrompt })
          .eq('id', recordId);
      } catch (err) {
        console.warn(`[remix] Enhancement failed: ${err instanceof Error ? err.message : err} — using original prompt`);
      }
    }

    // ─── Safety net: ensure preamble present in enhanced_prompt record ────
    // When enhance is ON, prepend preamble if missing so the debug record
    // (`enhanced_prompt`) shows the full prompt chain. The preamble is stripped
    // before Wavespeed — this is purely for traceability.
    if (enhancePrompt && !finalPrompt.match(/^Use this reference image as the source/)) {
      const preamble = getRemixPreamble(editType);
      console.log(`[remix] Safety net: prepending ${editType} preamble (was missing from final prompt)`);
      finalPrompt = `${preamble}\n\n${finalPrompt}`;
    }

    // Save final processed prompt (after ALL processing) for debugging.
    // The earlier save at vision enhancement only captures pre-JSON/pre-optimizer state.
    await supabase
      .from('remixes')
      .update({ enhanced_prompt: finalPrompt })
      .eq('id', recordId);

    // ─── Strip preamble before sending to Wavespeed ────────────
    // The preamble ("Use this reference image as the source...") is meta-instructions
    // about image array ordering. Wavespeed's API has no concept of image roles —
    // it just receives a flat `images[]` array and a text prompt. The preamble
    // wastes tokens and can confuse the diffusion model. Strip it so Wavespeed
    // only receives the descriptive scene prompt.
    // The preamble is preserved in `enhanced_prompt` (saved above) for debugging.
    const preamblePattern = /^Use this reference image as the source[\s\S]*?requested changes\.\s*/;
    if (preamblePattern.test(finalPrompt)) {
      const stripped = finalPrompt.replace(preamblePattern, '').trim();
      if (stripped.length > 0) {
        console.log(`[remix] Stripped preamble from Wavespeed prompt (${finalPrompt.length} → ${stripped.length} chars)`);
        finalPrompt = stripped;
      }
    }

    // Step 3: Prepare reference images
    // AI enhance ON:  [face1, face2, heroImage] — face refs for identity consistency
    // AI enhance OFF:  [heroImage] only — raw prompt, no face refs
    const router = getProviderRouter();
    let faceRefs: string[] = [];
    let character: ActiveCharacter | null = null;
    // A LoRA picked in the model menu (characterId) is used even with AI enhance off.
    if ((enhancePrompt || (typeof body.characterId === 'string' && body.characterId)) && persona) {
      const { data: personaRow } = await supabase
        .from('personas')
        .select('*, persona_refs(*)')
        .eq('name', persona)
        .single();
      // Trained character: the hero image is the scene she is placed into; no face refs are sent.
      let characterStills: string[] = [];
      if (personaRow && body.useCharacter !== false) {
        character = await activeCharacterFor(personaRow.id, (typeof body.characterId === 'string' && body.characterId) || personaRow.active_character_id);
        if (character && body.sceneEngine === 'nano') {
          characterStills = await characterReferenceStills(character, 3);
          console.log(`[remix] hybrid: ${model} scene + ${characterStills.length} LoRA stills from ${character.name}`);
          character = null;
        } else if (character && !characterCanEdit(character)) {
          // Text-only base (Z-Image): no LoRA edit endpoint. Use her best LoRA stills as the face references
          // for the normal Nano Banana edit path instead. Consistent references were what that path lacked.
          characterStills = await characterReferenceStills(character, 2);
          console.log(`[remix] ${character.name} is text-only; using ${characterStills.length} LoRA stills as references`);
          character = null;
        } else if (character) console.log(`[remix] Using trained character ${character.name}`);
      }
      if (characterStills.length) {
        faceRefs = characterStills;
        // Label what rendered: the image model plus the LoRA stills it was given.
        try { await supabase.from('remixes').update({ image_model: `${model} + LoRA stills` }).eq('id', recordId); } catch { /* best effort */ }
      }
      else if (personaRow?.persona_refs) {
        faceRefs = (personaRow.persona_refs as PersonaRef[])
          .filter((r) => r.ref_type === 'face')
          .sort((a, b) => a.slot - b.slot)
          .slice(0, 2)
          .map((r) => r.url);
        console.log(`[remix] Fetched ${faceRefs.length} face refs for ${persona}`);
      }
    }
    const validRefs = enhancePrompt ? [...faceRefs, resolvedHeroUrl].filter(Boolean) : [resolvedHeroUrl].filter(Boolean);
    console.log(`[remix] Reference images: ${validRefs.length} (${validRefs.map((u, i) => `[${i + 1}] ${u.startsWith('data:') ? 'data:...' : u.slice(0, 70)}`).join(' | ')})`);

    const stream = new ReadableStream({
      async start(controller) {
        const rid = recordId!; // recordId is guaranteed set by this point (Supabase record created above)
        try {
          sseEvent(controller, 'progress', { stage: 'Starting image generation...', recordId: rid, name: recordName });

          const allImageUrls: { url: string; index: number }[] = [];

          let result: WavespeedGenerationResult | { provider: string; requestId?: string; submittedAt?: string; completedAt?: string };
          if (character && !resolvedHeroUrl.startsWith('data:')) {
            const t0 = new Date().toISOString();
            const cg = await generateWithCharacter(character, {
              // Z-Image img2img builds its own short prompt from a scene caption; give it only the creator's words, not the long vision write-up.
              prompt: isWavespeedEdit(INFERENCE[character.base_model]?.edit ?? null) ? remixPrompt : finalPrompt, numImages: count, aspectRatio: uiAspectRatio || calculateAspectRatio(size), sceneUrl: resolvedHeroUrl,
              onProgress: (stage) => { try { sseEvent(controller, 'progress', { stage }); } catch { /* client disconnected */ } },
            });
            cg.urls.forEach((url, index) => {
              allImageUrls.push({ url, index });
              try { sseEvent(controller, 'image', { index, url, total: count }); } catch { /* client disconnected */ }
            });
            try { await supabase.from('remixes').update({ character_id: character.id, image_model: character.name, cost_usd: cg.costUsd, cost_source: 'rate_card' }).eq('id', rid); } catch { /* best effort */ }
            result = { provider: cg.model.startsWith('wavespeed:') ? cg.model : `fal:${cg.model}`, submittedAt: t0, completedAt: new Date().toISOString() };
          } else {
            result = await router.generate(model, {
              prompt: finalPrompt,
              images: validRefs,
              numImages: count,
              imageSize: size,
              aspectRatio: uiAspectRatio || calculateAspectRatio(size),
              resolution: uiResolution || '2k',
              params: uiParams,
            }, (url, index) => {
              allImageUrls.push({ url, index });
              try { sseEvent(controller, 'image', { index, url, total: count }); }
              catch { /* client disconnected */ }
            }, (stage) => {
              try { sseEvent(controller, 'progress', { stage }); }
              catch { /* client disconnected */ }
            });
          }

          // Save which provider was used (for Browse tab metadata)
          try { await supabase.from('remixes').update({ provider: result.provider, ...(('providerInput' in result && result.providerInput) ? { provider_input: { endpoint: result.endpoint, ...result.providerInput } } : {}) }).eq('id', rid); } catch { /* best effort */ }

          // Post-process: strip metadata + save to Supabase (remix_images table)
          try { sseEvent(controller, 'progress', { stage: 'Saving images...' }); }
          catch { /* client disconnected */ }

          // Get per-image metadata if available (Nanobanana provides per-image request IDs)
          const wsResult = result as WavespeedGenerationResult;
          const perImageResults = wsResult.perImageResults;

          console.log(`[remix] Stripping metadata from ${allImageUrls.length} images...`);
          await Promise.allSettled(allImageUrls.map(async ({ url: imgUrl, index: i }) => {
            try {
              const cleanBuffer = await fetchImageAsJpeg(imgUrl);
              console.log(`[remix] Image ${i + 1}/${allImageUrls.length} metadata stripped (${(cleanBuffer.length / 1024).toFixed(0)} KB)`);
              const storagePath = `${rid}/image_${i + 1}.jpg`;
              const publicUrl = await uploadFile('remix-images', storagePath, cleanBuffer);

              // Per-image audit metadata (wavespeed_request_id, submitted_at, completed_at)
              const imgMeta = perImageResults?.[i];

              await supabase.from('remix_images').insert({
                remix_id: rid,
                storage_path: storagePath,
                url: publicUrl,
                filename: `remix_${i + 1}.jpg`,
                size: cleanBuffer.length,
                mime_type: 'image/jpeg',
                sort_order: i,
                wavespeed_request_id: imgMeta?.wavespeedRequestId || result.requestId,
                submitted_at: imgMeta?.submittedAt || result.submittedAt,
                completed_at: imgMeta?.completedAt || result.completedAt,
              });
            } catch (uploadErr) {
              console.error(`[remix] Failed to strip/upload image ${i + 1}, falling back to URL:`, uploadErr);
              // Fallback: save raw URL
              await supabase.from('remix_images').insert({
                remix_id: rid,
                url: imgUrl,
                filename: `remix_${i + 1}.jpg`,
                sort_order: i,
                wavespeed_request_id: result.requestId,
                submitted_at: result.submittedAt,
                completed_at: result.completedAt,
              });
            }
          }));

          const imageCount = allImageUrls.length;
          const failedCount = count - imageCount;

          // Record partial failure so it shows in the UI
          if (failedCount > 0 && imageCount > 0) {
            await supabase.from('remixes').update({
              error_message: `${failedCount} of ${count} images failed to generate`,
            }).eq('id', rid);
          }

          if (imageCount === 0) {
            await supabase.from('remixes').update({
              error_message: 'All image generation requests failed',
            }).eq('id', rid);
          }

          const elapsedNum = (Date.now() - startTime) / 1000;
          const elapsed = elapsedNum.toFixed(1);
          console.log(`[remix] Done! ${recordName}: ${imageCount} images in ${elapsed}s`);

          // Persist duration
          try { await supabase.from('remixes').update({ duration_seconds: elapsedNum }).eq('id', rid); } catch { /* best effort */ }
          // Face-consistency score (scripts/scorer). Fire-and-forget; no-op without SCORER_URL.
          if (imageCount > 0) scoreRecordInBackground('remix', rid);

          try {
            sseEvent(controller, 'done', {
              success: imageCount > 0,
              recordId: rid,
              name: recordName,
              imageCount,
              requestedCount: count,
              failedCount,
              elapsed: `${elapsed}s`,
            });
          } catch { /* client disconnected — images already saved to Supabase */ }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[remix] SSE stream error:', errMsg);
          try { sseEvent(controller, 'error', { message: `Image generation failed: ${errMsg}`, fatal: true }); }
          catch { /* client disconnected */ }
          try {
            await supabase.from('remixes').update({ error_message: `Image generation failed: ${errMsg}`, duration_seconds: (Date.now() - startTime) / 1000 }).eq('id', rid);
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
    console.error('[remix] Unhandled error:', errMsg);
    // Write error to Supabase so the record doesn't appear stuck forever
    if (recordId) {
      try {
        await supabase
          .from('remixes')
          .update({ error_message: `Unhandled error: ${errMsg}` })
          .eq('id', recordId);
      } catch { /* best effort — don't mask the original error */ }
    }
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
