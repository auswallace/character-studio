import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: Fetch all ideas, newest first
export async function GET() {
  const { data, error } = await supabase
    .from('post_ideas')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch ideas' }, { status: 500 });
  }
  return NextResponse.json({ ideas: data });
}

// POST: Create a new idea
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { persona, images, caption_draft, platform } = body;

  if (!persona) {
    return NextResponse.json({ error: 'persona is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('post_ideas')
    .insert({
      persona,
      images: images || [],
      caption_draft: caption_draft || '',
      platform: platform || 'ig',
    })
    .select()
    .single();

  if (error) {
    console.error('[post-ideas] Insert error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create idea' }, { status: 500 });
  }
  return NextResponse.json({ idea: data }, { status: 201 });
}
