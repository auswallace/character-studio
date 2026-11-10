import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { errorResponse } from '@/lib/http';
import { INFERENCE, type CharacterBase } from '@/lib/characters/fal';

// GET /api/characters?persona_id=   -> { characters: [...] } newest version first
export async function GET(request: NextRequest) {
  try {
    const personaId = request.nextUrl.searchParams.get('persona_id');
    let q = supabase.from('characters').select('*').order('version', { ascending: false });
    if (personaId) q = q.eq('persona_id', personaId);
    const { data, error } = await q;
    if (error) throw error;
    // Each version carries the endpoints it generates with, so the Studio can load their manifests.
    const characters = (data || []).map(c => { const ep = INFERENCE[c.base_model as CharacterBase]; return { ...c, endpoints: ep ? { text: ep.text, edit: ep.edit } : null }; });
    return NextResponse.json({ characters });
  } catch (e) { return errorResponse(e, 'characters'); }
}
