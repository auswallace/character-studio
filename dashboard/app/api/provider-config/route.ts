import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { simulateForced } from '@/lib/simulate';

// ─── GET: Read current provider config ─────────────────────
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['primary_provider', 'fallback_provider', 'simulate_generation']);

    if (error) throw error;

    const config: Record<string, string> = {
      primary_provider: 'wavespeed',
      fallback_provider: 'fal',
      simulate_generation: 'false',
    };
    for (const row of data || []) {
      config[row.key] = row.value;
    }
    if (simulateForced()) {
      config.simulate_generation = 'true';
      config.simulate_forced = 'true';
    }

    return NextResponse.json(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[provider-config] GET error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── PATCH: Update provider config ─────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { primary_provider, fallback_provider } = body;

    const validProviders = ['wavespeed', 'fal'];

    if (primary_provider && !validProviders.includes(primary_provider)) {
      return NextResponse.json({ error: `Invalid primary_provider: ${primary_provider}` }, { status: 400 });
    }
    if (fallback_provider && !validProviders.includes(fallback_provider)) {
      return NextResponse.json({ error: `Invalid fallback_provider: ${fallback_provider}` }, { status: 400 });
    }
    if (primary_provider && fallback_provider && primary_provider === fallback_provider) {
      return NextResponse.json({ error: 'Primary and fallback providers must be different' }, { status: 400 });
    }

    const updates: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    if (primary_provider) {
      updates.push({ key: 'primary_provider', value: primary_provider, updated_at: now });
    }
    if (fallback_provider) {
      updates.push({ key: 'fallback_provider', value: fallback_provider, updated_at: now });
    }

    if (typeof body.simulate_generation === 'boolean') {
      updates.push({ key: 'simulate_generation', value: body.simulate_generation ? 'true' : 'false', updated_at: now });
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    for (const update of updates) {
      const { error } = await supabase
        .from('app_settings')
        .upsert(update, { onConflict: 'key' });
      if (error) throw error;
    }

    // Invalidate the cached router so next generation picks up the new config
    const { invalidateProviderRouter } = await import('@/lib/providers/router');
    invalidateProviderRouter();
    (await import('@/lib/simulate')).invalidateSimulateCache();

    console.log(`[provider-config] Updated: ${updates.map(u => `${u.key}=${u.value}`).join(', ')}`);
    return NextResponse.json({ success: true, updated: Object.fromEntries(updates.map(u => [u.key, u.value])) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[provider-config] PATCH error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
