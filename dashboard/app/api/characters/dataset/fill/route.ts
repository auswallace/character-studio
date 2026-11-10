import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';
import { uploadFile } from '@/lib/storage';
import { stripImageMetadata } from '@/lib/strip-metadata';
import { assertSpendAllowed } from '@/lib/spend-guard';
import { getProviderRouter } from '@/lib/providers';
import { imageCost } from '@/lib/pricing';
import { triggerFor } from '@/lib/characters/fal';
import { activeCharacterFor, generateWithCharacter } from '@/lib/characters/active';
import { CATALOG, SLOT_TARGETS, type SlotView } from '@/lib/characters/catalog';

// POST /api/characters/dataset/fill  { persona_id, max?: number, view?: 'face'|'half'|'full' }
// Generates one image per missing catalog slot (up to max) and adds it to the dataset UNAPPROVED
// with its caption and view already set. Uses the active trained character when there is one,
// otherwise the persona's reference photos through Nano Banana.
// GET  /api/characters/dataset/fill?persona_id=...   -> { gaps: { face, half, full }, slots: [...] }

interface Row { view: string | null; slot: string | null; approved: boolean }

async function plan(personaId: string) {
  const { data } = await supabase.from('dataset_images').select('view, slot, approved').eq('persona_id', personaId);
  const rows = (data || []) as Row[];
  const count: Record<SlotView, number> = { face: 0, half: 0, full: 0 };
  const used = new Set<string>();
  for (const r of rows) {
    if (r.slot) used.add(r.slot);
    if (!r.approved) continue;
    const v = (r.view || '').split(':')[0] as SlotView;
    if (v in count) count[v]++;
  }
  const gaps = { face: Math.max(0, SLOT_TARGETS.face - count.face), half: Math.max(0, SLOT_TARGETS.half - count.half), full: Math.max(0, SLOT_TARGETS.full - count.full) };
  const slots = (['face', 'half', 'full'] as SlotView[]).flatMap(v => CATALOG.filter(s => s.view === v && !used.has(s.key)).slice(0, gaps[v]));
  return { count, gaps, slots };
}

export async function GET(request: NextRequest) {
  try {
    const personaId = request.nextUrl.searchParams.get('persona_id');
    if (!personaId) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    const p = await plan(personaId);
    return NextResponse.json({ gaps: p.gaps, count: p.count, slots: p.slots.map(s => ({ key: s.key, view: s.view, prompt: s.prompt })) });
  } catch (e) { return errorResponse(e, 'characters/dataset/fill'); }
}

export async function POST(request: NextRequest) {
  try {
    const { persona_id, max, view } = await readJson<{ persona_id?: string; max?: number; view?: SlotView }>(request, 16);
    if (!persona_id) return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
    await assertSpendAllowed();

    const { data: persona } = await supabase.from('personas').select('id, name, traits, active_character_id, persona_refs(url, ref_type, slot)').eq('id', persona_id).single<{ id: string; name: string; traits: string | null; active_character_id: string | null; persona_refs: { url: string; ref_type: string; slot: number }[] }>();
    if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 404 });
    const trigger = triggerFor(persona.name);

    let { slots } = await plan(persona_id);
    if (view) slots = slots.filter(s => s.view === view);
    slots = slots.slice(0, Math.min(Math.max(Number(max) || 12, 1), 20));
    if (!slots.length) return NextResponse.json({ added: 0, cost_usd: 0, note: 'no gaps' });

    const character = await activeCharacterFor(persona.id, persona.active_character_id);
    const refs = character ? [] : [
      ...(persona.persona_refs || []).filter(r => r.ref_type === 'face').sort((a, b) => a.slot - b.slot).slice(0, 2).map(r => r.url),
      ...(persona.persona_refs || []).filter(r => r.ref_type === 'body').sort((a, b) => a.slot - b.slot).slice(0, 1).map(r => r.url),
    ];
    if (!character && !refs.length) return NextResponse.json({ error: 'no trained character and no reference photos for this persona' }, { status: 400 });
    const router = getProviderRouter();

    let added = 0, cost = 0; const failed: string[] = [];
    for (const slot of slots) {
      try {
        let url: string | undefined;
        if (character) {
          const r = await generateWithCharacter(character, { prompt: `${slot.prompt}, photoreal, natural skin texture`, numImages: 1, aspectRatio: '3:4' });
          url = r.urls[0]; cost += r.costUsd;
        } else {
          const traits = persona?.traits || '';
          const prompt = `The same person as in the reference images, exactly her face, hair and body. ${traits ? traits + '. ' : ''}${slot.prompt}. Photoreal, natural skin texture, no text.`;
          const urls: string[] = [];
          await router.generate('Nanobanana 2', { prompt, images: refs, numImages: 1, aspectRatio: '3:4', resolution: '2k' }, (u) => { urls.push(u); });
          url = urls[0]; cost += imageCost('Nanobanana 2', 1).costUsd ?? 0.04;
        }
        if (!url) throw new Error('no image');
        const clean = await stripImageMetadata(url);
        const path = `generated/${persona.id}/${slot.key}_${Date.now()}.jpg`;
        const publicUrl = await uploadFile('persona-datasets', path, clean);
        await supabase.from('dataset_images').insert({
          persona_id: persona.id, url: publicUrl, storage_path: path, source_kind: 'generated', approved: false,
          view: `${slot.view}:${slot.angle}`, slot: slot.key, caption: `${trigger}, ${slot.prompt}`,
        });
        added++;
      } catch (e) { failed.push(`${slot.key}: ${e instanceof Error ? e.message : e}`); }
    }
    return NextResponse.json({ added, failed, cost_usd: Number(cost.toFixed(3)), via: character ? character.name : 'reference photos' });
  } catch (e) { return errorResponse(e, 'characters/dataset/fill'); }
}
