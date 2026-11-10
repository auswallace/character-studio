import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;

    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    // 1. Get all post IDs for this username
    const { data: posts, error: postsError } = await supabase
      .from('scraped_posts')
      .select('id')
      .eq('username', username);

    if (postsError) throw new Error(`Failed to fetch posts: ${postsError.message}`);

    const postIds = (posts || []).map(p => p.id);

    // 2. Delete scraped_post_images for those posts
    if (postIds.length > 0) {
      const { error: imagesError } = await supabase
        .from('scraped_post_images')
        .delete()
        .in('post_id', postIds);

      if (imagesError) throw new Error(`Failed to delete images: ${imagesError.message}`);
    }

    // 3. Delete scraped_posts for this username
    const { error: deleteError } = await supabase
      .from('scraped_posts')
      .delete()
      .eq('username', username);

    if (deleteError) throw new Error(`Failed to delete posts: ${deleteError.message}`);

    return NextResponse.json({ deleted: postIds.length });
  } catch (error) {
    console.error('[api/inspiration/accounts/[username]] DELETE Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete account' },
      { status: 500 }
    );
  }
}
