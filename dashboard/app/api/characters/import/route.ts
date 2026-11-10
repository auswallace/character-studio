import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';
import { triggerFor, type CharacterBase } from '@/lib/characters/fal';

// POST /api/characters/import  { persona_id, lora_url, base: 'zimage'|'flux2'|'flux3klein', name?, trigger_word?, notes? }
// Registers an externally trained LoRA (e.g. ai-toolkit on RunPod) as a ready version, so it gets the
// same Studio, 4-shot check and scoring as fal-trained ones.

export async function POST(request: NextRequest) {
  try {
    const b = await readJson<{ persona_id?: string; lora_url?: string; base?: CharacterBase; name?: string; trigger_word?: string; notes?: string }>(request, 16);
    if (!b.persona_id || !b.lora_url || !/^https?:\/\//.test(b.lora_url)) return NextResponse.json({ error: 'persona_id and lora_url required' }, { status: 400 });
    const base: CharacterBase = (['zimage', 'flux2', 'flux3klein'] as CharacterBase[]).includes(b.base as CharacterBase) ? (b.base as CharacterBase) : 'zimage';
    const { data: persona } = await supabase.from('personas').select('id, name, active_character_id').eq('id', b.persona_id).single<{ id: string; name: string; active_character_id: string | null }>();
    if (!persona) return NextResponse.json({ error: 'persona not found' }, { status: 404 });
    const { data: last } = await supabase.from('characters').select('version').eq('persona_id', persona.id).order('version', { ascending: false }).limit(1).single<{ version: number }>();
    const version = (last?.version || 0) + 1;
    const name = (b.name || `${persona.name.split(' ')[0]} v${version} (imported)`).slice(0, 80);
    const { data: row, error } = await supabase.from('characters').insert({
      persona_id: persona.id, version, name, base_model: base, trigger_word: (b.trigger_word || triggerFor(persona.name)).slice(0, 40),
      lora_url: b.lora_url, status: 'ready', training_model: 'imported', steps: null, cost_usd: 0, dataset_snapshot: [], trained_at: new Date().toISOString(),
      error_message: b.notes ? b.notes.slice(0, 300) : null,
    }).select('id, name').single<{ id: string; name: string }>();
    if (error || !row) throw error || new Error('insert failed');
    if (!persona.active_character_id) await supabase.from('personas').update({ active_character_id: row.id }).eq('id', persona.id);
    return NextResponse.json({ id: row.id, name: row.name, version });
  } catch (e) { return errorResponse(e, 'characters/import'); }
}
