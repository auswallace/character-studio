import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('scrape_runs')
      .select('cost_usd');

    if (error) throw new Error(error.message);

    const totalCost = (data || []).reduce(
      (sum: number, r: { cost_usd: number | string }) => sum + Number(r.cost_usd || 0),
      0
    );

    return NextResponse.json({
      total_cost_usd: Math.round(totalCost * 10000) / 10000,
      run_count: (data || []).length,
    });
  } catch (error) {
    console.error('[scrape-costs] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch costs' }, { status: 500 });
  }
}
