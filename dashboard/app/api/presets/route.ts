import { NextRequest, NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { supabase } from '@/lib/supabase';

// ─── Video presets ("Moves") ──────────────────────────────
//
// GET  /api/presets                 list all, builtin first then user, by sort_order
// POST /api/presets                 create a user preset
//      { name, category?, description?, prompts: {seedance?, kling?, google?}, defaultCamera?, sourceVideoId? }
//
// A preset holds one prompt per model FAMILY. The client picks the family for
// the selected model (see lib/video-presets.ts) and fills the prompt box.
// Table: supabase/migrations/20261104_video_presets.sql

export interface VideoPreset {
  id: string;
  name: string;
  category: string;
  description: string | null;
  prompts: Record<string, string>;
  default_camera: string | null;
  source: 'builtin' | 'user';
  source_video_id: string | null;
  sort_order: number;
  created_at: string;
}

export async function GET() {
  const { data, error } = await supabase
    .from('video_presets')
    .select('*')
    .order('source', { ascending: true })   // builtin < user
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ presets: (data || []) as VideoPreset[] });
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request, 64);
    const name = String(body.name || '').trim();
    const prompts = body.prompts && typeof body.prompts === 'object' ? body.prompts as Record<string, string> : null;

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!prompts || !Object.values(prompts).some(v => typeof v === 'string' && v.trim())) {
      return NextResponse.json({ error: 'prompts needs at least one family entry' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('video_presets')
      .insert({
        name: name.slice(0, 80),
        category: String(body.category || 'user').slice(0, 40),
        description: body.description ? String(body.description).slice(0, 200) : null,
        prompts,
        default_camera: body.defaultCamera || null,
        source: 'user',
        source_video_id: body.sourceVideoId || null,
        sort_order: 500,
      })
      .select()
      .single<VideoPreset>();

    if (error) throw error;
    console.log(`[presets] created "${data.name}" (${Object.keys(prompts).join(',')})`);
    return NextResponse.json({ preset: data });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[presets] Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
