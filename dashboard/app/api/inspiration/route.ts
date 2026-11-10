import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface ScrapedPostImage {
  id: string;
  url: string | null;
  sort_order: number | null;
}

interface ScrapedPostRow {
  id: string;
  username: string | null;
  caption: string | null;
  likes: number;
  views: number;
  post_date: string | null;
  post_url: string | null;
  use_for_generation: boolean;
  scraped_post_images: ScrapedPostImage[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const favorites = searchParams.get('favorites') === '1';
    const limit = parseInt(searchParams.get('limit') || '100');
    const sort = searchParams.get('sort') || 'engagement';

    let query = supabase
      .from('scraped_posts')
      .select('*, scraped_post_images(*)')
      .limit(limit);

    if (sort === 'date') {
      query = query.order('created_at', { ascending: false });
    } else {
      // Default: engagement (likes + views, approximated by likes desc then views desc)
      query = query.order('likes', { ascending: false }).order('views', { ascending: false });
    }

    if (username) {
      query = query.eq('username', username);
    }
    if (favorites) {
      query = query.eq('use_for_generation', true);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Supabase query failed: ${error.message}`);

    const rows = (data || []) as ScrapedPostRow[];

    const posts = rows.map(r => ({
      id: r.id,
      username: r.username || '',
      images: (r.scraped_post_images || [])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(img => img.url)
        .filter(Boolean),
      caption: r.caption || '',
      likes: r.likes || 0,
      views: r.views || 0,
      postDate: r.post_date || '',
      postUrl: r.post_url || '',
      favorite: r.use_for_generation || false,
    }));

    return NextResponse.json({ posts });
  } catch (error) {
    console.error('[api/inspiration] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inspiration posts' },
      { status: 500 }
    );
  }
}
