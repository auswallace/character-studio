import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const account = searchParams.get('account');
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = supabase
      .from('x_scraped_content')
      .select('*')
      .order('engagement_score', { ascending: false })
      .limit(limit);

    if (account) {
      query = query.ilike('source_account', `%${account}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const posts = (data || []).map((r: Record<string, unknown>) => ({
      id: r.id,
      tweetId: r.original_tweet_id,
      sourceAccount: r.source_account,
      imageUrl: r.image_url,
      likes: r.likes || 0,
      retweets: r.retweets || 0,
      bookmarks: r.bookmarks || 0,
      views: r.views || 0,
      engagementScore: r.engagement_score || 0,
      status: r.status || 'New',
      postUrl: r.post_url || (r.original_tweet_id ? `https://x.com/i/status/${r.original_tweet_id}` : ''),
      scrapedAt: r.scraped_at || r.created_at || '',
    }));

    return NextResponse.json({ posts });
  } catch (error) {
    console.error('[api/inspiration/x-posts] GET Error:', error);
    return NextResponse.json({ error: 'Failed to fetch X posts' }, { status: 500 });
  }
}
