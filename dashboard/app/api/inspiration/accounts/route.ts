import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('scraped_posts')
      .select('username');

    if (error) throw new Error(`Supabase query failed: ${error.message}`);

    const counts = new Map<string, number>();
    for (const r of data || []) {
      const username = r.username || '';
      if (!username) continue;
      counts.set(username, (counts.get(username) || 0) + 1);
    }

    const accounts = Array.from(counts.entries())
      .map(([username, count]) => ({ username, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('[api/inspiration/accounts] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}
