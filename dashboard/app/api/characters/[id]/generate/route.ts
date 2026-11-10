import { NextRequest, NextResponse } from 'next/server';
import { supabase, apiKeys } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';
import { uploadFile } from '@/lib/storage';
import { assertSpendAllowed } from '@/lib/spend-guard';
import { scoreRecordInBackground } from '@/lib/scorer';
import { stripImageMetadata } from '@/lib/strip-metadata';
import { deidentifyScene } from '@/lib/deidentify';
import { INFERENCE, falRun, type CharacterBase } from '@/lib/characters/fal';
import { buildInput } from '@/lib/models/manifest';
import { runWavespeedJob } from '@/lib/wavespeed-poll';
import { upscaleRecordImages } from '@/lib/upscale';
import { describeSceneForImg2img, sceneSize } from '@/lib/characters/scene';

// POST /api/characters/[id]/generate
// { prompt, sceneUrl?, sceneMode?: 'reference'|'pose', scale?, numImages?, aspect?: '9:16'|'1:1'|'16:9'|'3:4' }
// sceneMode 'pose' swaps the scene person for a grey mannequin first (lib/deidentify.ts, ~$0.04, cached).
// Text-only -> qwen-image / flux-2 lora. With sceneUrl (Qwen only) -> qwen-image-edit-plus-lora.
// Saves a `generations` row (+ images) so results show in Gallery/Library like everything else.

export const maxDuration = 300;


const SIZES: Record<string, string> = { '9:16': 'portrait_16_9', '3:4': 'portrait_4_3', '1:1': 'square_hd', '16:9': 'landscape_16_9' };

interface CharRow { id: string; persona_id: string; name: string; base_model: CharacterBase; trigger_word: string; lora_url: string | null; status: string }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readJson<{ prompt?: string; sceneUrl?: string; sceneMode?: 'reference' | 'pose'; scale?: number; numImages?: number; aspect?: string; tag?: string; seed?: number; enhance?: boolean; steps?: number; strength?: number; upscale?: boolean; params?: Record<string, unknown> }>(request, 32);
    const { data: ch } = await supabase.from('characters').select('*').eq('id', id).single<CharRow>();
    if (!ch) return NextResponse.json({ error: 'character not found' }, { status: 404 });
    if (ch.status !== 'ready' || !ch.lora_url) return NextResponse.json({ error: `character is ${ch.status}` }, { status: 400 });
    const prompt = (body.prompt || '').trim();
    if (!prompt && !body.sceneUrl) return NextResponse.json({ error: 'prompt or sceneUrl required' }, { status: 400 });
    await assertSpendAllowed();

    const ep = INFERENCE[ch.base_model];
    const scale = Math.min(Math.max(Number(body.scale) || 1.0, 0.3), 4.0);   // fal allows 0-4
    const numImages = Math.min(Math.max(Number(body.numImages) || 1, 1), 4);
    // Prompt expansion: fal rewrites the prompt for composition/realism. On for real use, off for the 4-shot check so versions compare fairly.
    // User settings come as `params` keyed by the provider's own field names (rendered from the manifest).
    // Older callers may still send enhance/steps/strength; fold them in. The 4-shot check forces expansion off.
    const settings: Record<string, unknown> = { ...(body.params || {}) };
    if (body.enhance != null && settings.enable_prompt_expansion == null) settings.enable_prompt_expansion = body.enhance;
    if (body.steps != null && settings.num_inference_steps == null) settings.num_inference_steps = body.steps;
    if (body.strength != null && settings.strength == null) settings.strength = body.strength;
    if (body.tag === 'check') settings.enable_prompt_expansion = false;
    if (settings.num_images == null) settings.num_images = numImages;
    const T = ch.trigger_word;
    const loras = [{ path: ch.lora_url, scale }];

    let model: string;
    let input: Record<string, unknown>;
    let fullPrompt: string;
    let sceneInput = body.sceneUrl || '';
    let extraCost = 0;
    if (body.sceneUrl) {
      if (!ep.edit) return NextResponse.json({ error: `${ch.name} is a text-only base (${ch.base_model}): it cannot take a scene image here. Clear the scene, or use the Remix tab, which places her into a photo with her best stills as references.` }, { status: 400 });
      model = ep.edit;
      if (body.sceneMode === 'pose') {
        const m = await deidentifyScene(body.sceneUrl); // no aspect: keep the scene's own framing
        sceneInput = m.url;
        extraCost = m.costUsd;
      }
      fullPrompt = `${T} in the exact pose, framing, camera angle and setting of the reference image. Keep the clothing and background from the reference. The person in the output is ${T}: replace the reference person's face, hair and body with ${T}. ${prompt} Photoreal, natural skin texture.`.replace(/\s+/g, ' ');
      if (model.startsWith('wavespeed:')) {
        // WaveSpeed img2img + LoRA (Z-Image). The prompt must DESCRIBE the target image (img2img has no notion of
        // "the reference"), so Grok captions the scene and the trigger word carries identity. Size follows the scene.
        // strength: how far to move from the source. Pose-only (mannequin) has no foreign face to fight, so lower keeps the pose.
        const described = await describeSceneForImg2img(sceneInput, T);
        fullPrompt = described ? `${described}${prompt ? ` ${prompt}` : ''} Photoreal, natural skin texture, sharp detail.` : fullPrompt;
        if (settings.strength == null) settings.strength = body.sceneMode === 'pose' ? 0.55 : 0.7;
        const built = buildInput(model, settings, { image: sceneInput, prompt: fullPrompt, loras, size: await sceneSize(sceneInput), seed: body.seed != null ? Number(body.seed) : undefined });
        input = built.body; if (built.notes.length) console.log(`[characters/generate] manifest notes: ${built.notes.join('; ')}`);
      } else {
        const built = buildInput(model, settings, { prompt: fullPrompt, image_urls: [sceneInput], loras, seed: body.seed != null ? Number(body.seed) : undefined });
        input = built.body; if (built.notes.length) console.log(`[characters/generate] manifest notes: ${built.notes.join('; ')}`);
      }
    } else {
      model = ep.text;
      fullPrompt = prompt.toLowerCase().startsWith(T) ? prompt : `${T}, ${prompt}`;
      const built = buildInput(model, settings, { prompt: fullPrompt, loras, image_size: SIZES[body.aspect || '9:16'] || 'portrait_16_9', seed: body.seed != null ? Number(body.seed) : undefined });
      input = built.body; if (built.notes.length) console.log(`[characters/generate] manifest notes: ${built.notes.join('; ')}`);
    }

    const { data: persona } = await supabase.from('personas').select('name').eq('id', ch.persona_id).single<{ name: string }>();
    const { count } = await supabase.from('generations').select('*', { count: 'exact', head: true }).ilike('name', `${(persona?.name || 'char').split(' ')[0].toLowerCase()}_chr_%`);
    const genName = `${(persona?.name || 'char').split(' ')[0].toLowerCase()}_chr_${String((count || 0) + 1).padStart(4, '0')}${body.tag === 'check' ? '_check' : ''}`;

    const { data: gen, error: genErr } = await supabase.from('generations').insert({
      name: genName, persona: persona?.name || null, persona_id: ch.persona_id, image_model: ch.name, prompt: fullPrompt,
      prompt_image_url: body.sceneUrl || null, character_id: ch.id, provider: model.startsWith('wavespeed:') ? 'wavespeed' : 'fal',
      provider_input: { endpoint: model, ...input, loras: loras.map(l => ({ path: l.path.split('/').pop(), scale: l.scale })) },
    }).select().single<{ id: string }>();
    if (genErr || !gen) throw genErr || new Error('could not create generation');

    const t0 = Date.now();
    let urls: string[] = [];
    if (model.startsWith('wavespeed:')) {
      const endpoint = `https://api.wavespeed.ai/api/v3/${model.slice('wavespeed:'.length)}`;
      const all: string[] = [];
      const want = Math.min(Math.max(Number(settings.num_images) || numImages, 1), 4);
      for (let i = 0; i < want; i++) {   // the endpoint returns one image per call
        const r = await runWavespeedJob({ endpoint, body: { ...input, ...(i ? { seed: -1 } : {}) }, apiKey: apiKeys.wavespeed, tag: 'character', label: ch.name, pollIntervalMs: 2000, maxPolls: 150 });
        all.push(...r.outputs);
      }
      urls = all.filter(Boolean);
    } else {
      const result = await falRun<{ images?: { url: string; width?: number; height?: number }[] }>(model, input, { pollMs: 3000 });
      urls = (result.images || []).map(i => i.url).filter(Boolean);
    }
    if (!urls.length) throw new Error('provider returned no images');

    const saved: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      try {
        const clean = await stripImageMetadata(urls[i]);
        const path = `${gen.id}/image_${i + 1}.jpg`;
        const url = await uploadFile('generated-images', path, clean, 'image/jpeg');
        await supabase.from('generation_images').insert({ generation_id: gen.id, storage_path: path, url, filename: `image_${i + 1}.jpg`, size: clean.length, mime_type: 'image/jpeg', sort_order: i });
        saved.push(url);
      } catch (e) { console.warn(`[characters/generate] save ${i + 1} failed: ${e instanceof Error ? e.message : e}`); }
    }
    const mp = 1.2 * saved.length; // ~1.2 MP per portrait output
    const cost = Number((mp * ep.perMp + extraCost).toFixed(4));
    await supabase.from('generations').update({ duration_seconds: (Date.now() - t0) / 1000, cost_usd: cost, cost_source: 'rate_card', error_message: saved.length ? null : 'no images saved' }).eq('id', gen.id);
    if (saved.length) scoreRecordInBackground('generation', gen.id);
    if (saved.length && body.upscale) { void upscaleRecordImages('Generation', gen.id).catch(e => console.warn('[characters/generate] upscale failed:', e instanceof Error ? e.message : e)); }

    console.log(`[characters/generate] ${ch.name}: ${saved.length}/${urls.length} saved via ${model} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return NextResponse.json({ generationId: gen.id, name: genName, images: saved, model, prompt: fullPrompt, cost_usd: cost, providerInput: { endpoint: model, ...input, loras: loras.map(l => ({ path: l.path.split('/').pop(), scale: l.scale })) }, poseUrl: sceneInput !== body.sceneUrl ? sceneInput : null });
  } catch (e) { return errorResponse(e, 'characters/generate'); }
}
