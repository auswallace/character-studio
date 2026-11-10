import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface SocialPostMediaRow {
  id: string;
  url: string;
  filename: string;
  storage_path: string | null;
  media_type: string;
  width: number | null;
  height: number | null;
  sort_order: number | null;
}

interface SocialPostRow {
  id: string;
  title: string | null;
  status: string | null;
  persona: string | null;
  platforms: string[] | null;
  caption_instagram: string | null;
  caption_twitter: string | null;
  caption_tiktok: string | null;
  caption_threads: string | null;
  notes: string | null;
  schedule_date: string | null;
  schedule_mode: string | null;
  published_urls: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
  social_post_media: SocialPostMediaRow[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = supabase
      .from('social_posts')
      .select('*, social_post_media(*)')
      .order('schedule_date', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error('[api/social-posts] Supabase error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch social posts' },
        { status: 500 }
      );
    }

    const posts = (rows as SocialPostRow[]).map(row => {
      const media = (row.social_post_media || []).sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
      const firstImage = media.find(m => m.media_type === 'image');
      const firstVideo = media.find(m => m.media_type === 'video');

      return {
        id: row.id,
        status: row.status || 'unknown',
        image: firstImage?.url || null,
        imageThumbnail: firstImage?.url || null,
        images: media
          .filter(m => m.media_type === 'image')
          .map(m => ({
            id: m.id,
            url: m.url,
            filename: m.filename,
            thumbnailUrl: m.url,
          })),
        video: firstVideo?.url || null,
        platforms: row.platforms || [],
        persona: row.persona || '',
        captionIG: row.caption_instagram || '',
        captionTwitter: row.caption_twitter || '',
        captionTikTok: row.caption_tiktok || '',
        captionThreads: row.caption_threads || '',
        scheduledFor: row.schedule_date || '',
        scheduleMode: row.schedule_mode || '',
        publishedUrls: row.published_urls || '',
        error: row.error || null,
        title: row.title || '',
        notes: row.notes || '',
        createdAt: row.created_at,
      };
    });

    return NextResponse.json({ posts });
  } catch (error) {
    console.error('[api/social-posts] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch social posts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl, imageUrls, persona, platforms, captionIG, captionTwitter, captionThreads, captionTikTok, scheduleDate, notes } = body;

    if (!persona || !platforms?.length) {
      return NextResponse.json(
        { error: 'persona and platforms are required' },
        { status: 400 }
      );
    }

    // Build the social_posts row
    const postFields: Record<string, unknown> = {
      persona,
      platforms,
      status: 'Draft',
    };

    if (captionIG) postFields.caption_instagram = captionIG;
    if (captionTwitter) postFields.caption_twitter = captionTwitter;
    if (captionThreads) postFields.caption_threads = captionThreads;
    if (captionTikTok) postFields.caption_tiktok = captionTikTok;
    if (scheduleDate) postFields.schedule_date = scheduleDate;
    if (notes) postFields.notes = notes;

    const { data: post, error: postError } = await supabase
      .from('social_posts')
      .insert(postFields)
      .select()
      .single();

    if (postError || !post) {
      console.error('[api/social-posts] Insert error:', postError);
      return NextResponse.json(
        { error: 'Failed to create social post' },
        { status: 500 }
      );
    }

    // Insert media rows — just reference the provided URLs (they already live in
    // generated-images/ or remix-images/ buckets)
    const urls: string[] = imageUrls || (imageUrl ? [imageUrl] : []);
    if (urls.length > 0) {
      const mediaRows = urls.map((url, idx) => {
        // Extract storage path from Supabase public URL
        // URL format: {SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}
        const marker = '/storage/v1/object/public/';
        const markerIdx = url.indexOf(marker);
        const storagePath = markerIdx !== -1
          ? url.substring(markerIdx + marker.length)
          : `social-media/post_${post.id}_${idx}.jpg`;

        return {
          post_id: post.id,
          url,
          storage_path: storagePath,
          filename: `image_${idx}.jpg`,
          media_type: 'image',
          sort_order: idx,
        };
      });

      const { error: mediaError } = await supabase
        .from('social_post_media')
        .insert(mediaRows);

      if (mediaError) {
        console.error('[api/social-posts] Media insert error:', mediaError);
        // Post was created — log but don't fail the whole request
      }
    }

    return NextResponse.json({
      id: post.id,
      status: post.status,
      message: 'Post created successfully.',
    });
  } catch (error) {
    console.error('[api/social-posts] POST Error:', error);
    return NextResponse.json(
      { error: 'Failed to create social post' },
      { status: 500 }
    );
  }
}
