import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ─── GET — list version history for a template key ──────────────
// Usage: GET /api/prompt-templates/versions?key=generate:vision
//        GET /api/prompt-templates/versions (all versions, grouped)
export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get('key');

    let query = supabase
      .from('prompt_template_versions')
      .select('id, template_key, content, version, change_summary, created_at')
      .order('created_at', { ascending: false });

    if (key) {
      query = query.eq('template_key', key);
    }

    const { data, error } = await query.limit(100);

    if (error) {
      console.error('[prompt-template-versions] GET error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ versions: data || [] });
  } catch (err) {
    console.error('[prompt-template-versions] GET unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST — snapshot all current templates as versioned records ──
// Usage: POST /api/prompt-templates/versions { changeSummary: "Initial snapshot" }
// This is idempotent — if versions already exist for a key, it skips that key.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const changeSummary = (body as { changeSummary?: string }).changeSummary || 'Initial snapshot';

    // Fetch all current templates from DB
    const { data: dbRows } = await supabase
      .from('prompt_templates')
      .select('key, content');

    // Check which keys already have versions
    const { data: existingVersions } = await supabase
      .from('prompt_template_versions')
      .select('template_key')
      .limit(500);

    const versionedKeys = new Set((existingVersions || []).map(v => v.template_key));
    const dbMap = new Map((dbRows || []).map(r => [r.key, r.content]));

    // Import defaults to cover keys that aren't in DB yet
    const { TEMPLATE_KEYS } = await import('@/lib/prompt-templates');
    const allKeys = Object.values(TEMPLATE_KEYS);

    const toInsert: { template_key: string; content: string; version: number; change_summary: string }[] = [];

    for (const key of allKeys) {
      if (versionedKeys.has(key)) continue; // already has version history

      // Use DB content if it exists, otherwise we skip (default-only templates
      // get their first version when they're first customized)
      const content = dbMap.get(key);
      if (!content) continue;

      toInsert.push({
        template_key: key,
        content,
        version: 1,
        change_summary: changeSummary,
      });
    }

    if (toInsert.length === 0) {
      return NextResponse.json({ message: 'All templates already have version history', snapshotted: 0 });
    }

    const { error } = await supabase
      .from('prompt_template_versions')
      .insert(toInsert);

    if (error) {
      console.error('[prompt-template-versions] POST error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: `Snapshotted ${toInsert.length} templates as v1`,
      snapshotted: toInsert.length,
      keys: toInsert.map(r => r.template_key),
    });
  } catch (err) {
    console.error('[prompt-template-versions] POST unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
