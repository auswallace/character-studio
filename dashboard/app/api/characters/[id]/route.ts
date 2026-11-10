import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse, readJson } from '@/lib/http';
import { falStatus, falResult } from '@/lib/characters/fal';

// GET  /api/characters/[id]        -> refreshes a training row from fal if still training, returns it
// PATCH /api/characters/[id]       -> { action: 'activate' | 'retire' }
// DELETE /api/characters/[id]

interface CharacterRow {
  id: string; persona_id: string; status: string; training_run_id: string | null; training_model: string | null;
  lora_url: string | null; version: number; name: string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data: row, error } = await supabase.from('characters').select('*').eq('id', id).single<CharacterRow & Record<string, unknown>>();
    if (error || !row) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (row.status === 'training' && row.training_run_id && row.training_model) {
      try {
        const s = await falStatus(row.training_model, row.training_run_id);
        const lastLog = s.logs?.at?.(-1)?.message || null;
        if (s.status === 'COMPLETED') {
          const r = await falResult<{ diffusers_lora_file?: { url: string }; lora_file?: { url: string }; config_file?: { url: string } }>(row.training_model, row.training_run_id);
          const lora_url = r.diffusers_lora_file?.url || r.lora_file?.url || null;
          const patch = lora_url
            ? { status: 'ready', lora_url, config_url: r.config_file?.url || null, trained_at: new Date().toISOString(), error_message: null }
            : { status: 'failed', error_message: 'training completed but returned no LoRA file' };
          const { data: upd } = await supabase.from('characters').update(patch).eq('id', id).select().single();
          // first ready version becomes active automatically
          if (lora_url) {
            const { data: p } = await supabase.from('personas').select('active_character_id').eq('id', row.persona_id).single<{ active_character_id: string | null }>();
            if (!p?.active_character_id) await supabase.from('personas').update({ active_character_id: id }).eq('id', row.persona_id);
          }
          return NextResponse.json({ character: upd, fal: { status: s.status } });
        }
        if (s.status === 'FAILED') {
          const { data: upd } = await supabase.from('characters').update({ status: 'failed', error_message: JSON.stringify(s.error || lastLog || 'failed').slice(0, 500) }).eq('id', id).select().single();
          return NextResponse.json({ character: upd, fal: { status: s.status } });
        }
        return NextResponse.json({ character: row, fal: { status: s.status, log: lastLog } });
      } catch (e) {
        return NextResponse.json({ character: row, fal: { status: 'UNKNOWN', error: e instanceof Error ? e.message : String(e) } });
      }
    }
    return NextResponse.json({ character: row });
  } catch (e) { return errorResponse(e, 'characters/[id]'); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action } = await readJson<{ action?: string }>(request, 16);
    const { data: row } = await supabase.from('characters').select('id, persona_id, status').eq('id', id).single<CharacterRow>();
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (action === 'activate') {
      if (row.status !== 'ready') return NextResponse.json({ error: 'only ready characters can be activated' }, { status: 400 });
      await supabase.from('personas').update({ active_character_id: id }).eq('id', row.persona_id);
      return NextResponse.json({ success: true });
    }
    if (action === 'retire') {
      await supabase.from('characters').update({ status: 'retired' }).eq('id', id);
      const { data: p } = await supabase.from('personas').select('active_character_id').eq('id', row.persona_id).single<{ active_character_id: string | null }>();
      if (p?.active_character_id === id) await supabase.from('personas').update({ active_character_id: null }).eq('id', row.persona_id);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) { return errorResponse(e, 'characters/[id]'); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data: row } = await supabase.from('characters').select('id, persona_id, status').eq('id', id).single<CharacterRow>();
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (row.status === 'training') return NextResponse.json({ error: 'cannot delete while training' }, { status: 400 });
    const { data: p } = await supabase.from('personas').select('active_character_id').eq('id', row.persona_id).single<{ active_character_id: string | null }>();
    if (p?.active_character_id === id) await supabase.from('personas').update({ active_character_id: null }).eq('id', row.persona_id);
    await supabase.from('characters').delete().eq('id', id);
    return NextResponse.json({ success: true });
  } catch (e) { return errorResponse(e, 'characters/[id]'); }
}
