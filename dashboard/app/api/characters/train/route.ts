import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';
import { safeFetch } from '@/lib/safe-url';
import { uploadFile } from '@/lib/storage';
import { assertSpendAllowed } from '@/lib/spend-guard';
import { buildZip } from '@/lib/characters/zip';
import sharp from 'sharp';
import { TRAINERS, falSubmit, triggerFor, trainerManaged, trainerDefaults, type CharacterBase } from '@/lib/characters/fal';
import { buildInput } from '@/lib/models/manifest';

// POST /api/characters/train  { persona_id, base?, steps?, learning_rate?, params?: Record<string, unknown> }
// `params` are trainer fields in the provider's own names (steps, learning_rate, resolution, training_type, ...);
// they are validated against lib/models/<trainer>.json by buildInput, so what the Advanced row shows is what fal gets.
// Freezes the approved+captioned dataset, zips it, uploads, submits to the fal trainer,
// creates a `characters` row with status 'training'. Poll GET /api/characters/[id] for progress.

export const maxDuration = 300;

interface DatasetRow { id: string; url: string; caption: string | null; view: string | null; score: number | null; source_kind: string; source_image_id: string | null }

export async function POST(request: NextRequest) {
  try {
    const body = await readJson<{ persona_id?: string; base?: CharacterBase; steps?: number; learning_rate?: number; params?: Record<string, unknown> }>(request, 16);
    if (!body.persona_id) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    const base: CharacterBase = (['qwen', 'flux3klein', 'zimage', 'flux2'] as CharacterBase[]).includes(body.base as CharacterBase) ? (body.base as CharacterBase) : 'flux2';
    if (TRAINERS[base].deprecated) return NextResponse.json({ error: `${TRAINERS[base].label}: this trainer is deprecated on fal and jobs never run. Use FLUX.2.` }, { status: 400 });
    const trainer = TRAINERS[base];
    const params: Record<string, unknown> = { ...trainerDefaults(base, 1000), ...(body.params || {}) };
    if (body.steps != null) params.steps = Number(body.steps);
    if (body.learning_rate != null) params.learning_rate = Number(body.learning_rate);
    const steps = Math.min(Math.max(Number(params.steps) || 1000, trainer.minSteps), 3000);
    params.steps = steps;
    // fal default is 0.00005, which came out nearly inert on v2 (identity only visible at LoRA scale 3). Default here: 0.0002.
    const learningRate = Math.min(Math.max(Number(params.learning_rate) || TRAINERS[base].defaultLr, 0.00001), 0.001);
    params.learning_rate = learningRate;
    await assertSpendAllowed();

    const { data: persona } = await supabase.from('personas').select('id, name').eq('id', body.persona_id).single<{ id: string; name: string }>();
    if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 404 });

    const { data: imgs, error } = await supabase.from('dataset_images').select('id, url, caption, view, score, source_kind, source_image_id').eq('persona_id', persona.id).eq('approved', true);
    if (error) throw error;
    const ready = (imgs || []).filter((i: DatasetRow) => i.caption && i.caption.trim());
    if (ready.length < 10) return NextResponse.json({ error: `need at least 10 approved + captioned images (have ${ready.length})` }, { status: 400 });

    const { data: existing } = await supabase.from('characters').select('version').eq('persona_id', persona.id).order('version', { ascending: false }).limit(1);
    const version = ((existing?.[0] as { version: number } | undefined)?.version || 0) + 1;
    const trigger = triggerFor(persona.name);
    const name = `${persona.name.split(' ')[0]} v${version}`;

    // 1. zip images + captions
    const entries: { name: string; data: Buffer }[] = [];
    let idx = 0;
    for (const img of ready as DatasetRow[]) {
      idx++;
      const res = await safeFetch(img.url, { purpose: 'dataset image' });
      if (!res.ok) continue;
      // Trainers work at ~1024px. Shrink the 20 MB PNGs to 1536px JPEG so the zip stays small
      // (storage caps one file at 50 MB) and the upload is quick. Nothing the trainer sees is lost.
      const raw = Buffer.from(await res.arrayBuffer());
      const data = await sharp(raw).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
      const ext = 'jpg';
      const stem = `image_${String(idx).padStart(3, '0')}`;
      let cap = img.caption!.trim();
      if (!cap.toLowerCase().startsWith(trigger)) {
        // "mia stands outdoors..." from an older dataset -> "<trigger>, stands outdoors..."
        const m = cap.match(/^([a-z][a-z0-9_]{1,15})[,\s]+(.*)$/i);
        cap = m && !/^(a|an|the|close|full|half|medium|wide|photo|portrait)$/i.test(m[1]) ? `${trigger}, ${m[2]}` : `${trigger}, ${cap}`;
      }
      entries.push({ name: `${stem}.${ext}`, data }, { name: `${stem}.txt`, data: Buffer.from(cap + '\n', 'utf8') });
    }
    if (entries.length < 20) return NextResponse.json({ error: 'fewer than 10 images could be downloaded' }, { status: 500 });
    const zip = buildZip(entries);
    const zipPath = `datasets/${persona.id}/v${version}-${base}-${Date.now()}.zip`;
    const zipUrl = await uploadFile('persona-datasets', zipPath, zip, 'application/zip');

    // 2. submit training
    const built = buildInput(trainer.model, params, trainerManaged(base, zipUrl, trigger));
    if (built.notes.length) console.log(`[characters/train] manifest notes: ${built.notes.join('; ')}`);
    const { requestId } = await falSubmit(trainer.model, built.body);
    const cost = Number((steps * trainer.ratePerStep).toFixed(4));

    const { data: row, error: insErr } = await supabase.from('characters').insert({
      persona_id: persona.id, version, name, base_model: base, trigger_word: trigger,
      status: 'training', training_run_id: requestId, training_model: trainer.model,
      dataset_snapshot: ready.map((i: DatasetRow) => ({ id: i.id, url: i.url, caption: i.caption, view: i.view, score: i.score })),
      dataset_zip_url: zipUrl, steps, learning_rate: learningRate, cost_usd: cost, provider_input: built.body,
    }).select().single();
    if (insErr) throw insErr;

    console.log(`[characters/train] ${name}: ${entries.length / 2} images, ${trainer.label}, ${steps} steps, lr ${learningRate}, fal ${requestId}`);
    return NextResponse.json({ character: row, images: entries.length / 2, est_cost_usd: cost });
  } catch (e) { return errorResponse(e, 'characters/train'); }
}
