import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const account = username.startsWith('@') ? username : `@${username}`;

    const { data, error } = await supabase
      .from('x_scraped_content')
      .delete()
      .ilike('source_account', account)
      .select('id');

    if (error) throw new Error(error.message);

    return NextResponse.json({ deleted: (data || []).length });
  } catch (error) {
    console.error('[x-accounts/delete] Error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
