import { NextRequest, NextResponse } from 'next/server';
import { supabase, apiKeys } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { captionIG, captionTwitter, captionThreads, captionTikTok, images, scheduledFor } = body;

    const fields: Record<string, unknown> = {};

    if (captionIG !== undefined) fields.caption_instagram = captionIG;
    if (captionTwitter !== undefined) fields.caption_twitter = captionTwitter;
    if (captionThreads !== undefined) fields.caption_threads = captionThreads;
    if (captionTikTok !== undefined) fields.caption_tiktok = captionTikTok;
    if (scheduledFor !== undefined) fields.schedule_date = scheduledFor;

    // Image reorder: delete existing media rows and re-insert in the new order.
    // Each image should have { id?, url } — we re-insert with new sort_order values.
    if (images !== undefined && Array.isArray(images)) {
      // Delete existing media rows for this post
      await supabase.from('social_post_media').delete().eq('post_id', id);

      // Re-insert in the new order
      const mediaRows = images.map((img: { id?: string; url?: string }, idx: number) => ({
        post_id: id,
        url: img.url || '',
        filename: `image_${idx}.jpg`,
        media_type: 'image',
        sort_order: idx,
      }));

      if (mediaRows.length > 0) {
        const { error: mediaError } = await supabase
          .from('social_post_media')
          .insert(mediaRows);
        if (mediaError) {
          console.error('[social-posts/[id]] Media reorder error:', mediaError);
        }
      }
    }

    if (Object.keys(fields).length === 0 && !images) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    if (Object.keys(fields).length > 0) {
      const { error } = await supabase
        .from('social_posts')
        .update(fields)
        .eq('id', id);

      if (error) {
        console.error('[social-posts/[id]] Update error:', error);
        return NextResponse.json(
          { error: 'Failed to update social post' },
          { status: 500 }
        );
      }
    }

    // Reschedule in Late if the post is already scheduled there
    if (scheduledFor !== undefined) {
      try {
        const { data: record, error: readErr } = await supabase
          .from('social_posts')
          .select('status, published_urls')
          .eq('id', id)
          .single();

        if (!readErr && record) {
          const publishedUrls = record.published_urls || '';
          const status = (record.status || '').toLowerCase();

          if (status === 'scheduled' && publishedUrls.includes('getlate.dev')) {
            const lateToken = apiKeys.late;
            if (lateToken) {
              const LATE_BASE = 'https://getlate.dev/api/v1';
              const lateIdRegex = /getlate\.dev\/app\/post\/([a-f0-9]+)/gi;
              let match: RegExpExecArray | null;
              const lateIds: string[] = [];
              while ((match = lateIdRegex.exec(publishedUrls)) !== null) {
                lateIds.push(match[1]);
              }

              const newLateUrls: string[] = [];
              for (const lateId of lateIds) {
                const newUrl = await rescheduleLatePost(lateToken, LATE_BASE, lateId, scheduledFor);
                newLateUrls.push(newUrl);
              }

              if (newLateUrls.length > 0) {
                await supabase
                  .from('social_posts')
                  .update({ published_urls: newLateUrls.join('\n') })
                  .eq('id', id);
              }
            }
          }
        }
      } catch (lateErr) {
        // Late reschedule is non-fatal — DB date is already updated
        console.warn('[social-posts/[id]] Late reschedule failed (non-fatal):', lateErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/social-posts/[id]] PATCH Error:', error);
    return NextResponse.json(
      { error: 'Failed to update social post' },
      { status: 500 }
    );
  }
}

// --- Late reschedule helper (PATCH -> fallback to delete+recreate) ---

const LATE_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

async function rescheduleLatePost(
  token: string,
  baseUrl: string,
  lateId: string,
  newScheduledFor: string,
): Promise<string> {
  // Try PATCH first
  try {
    const patchRes = await fetch(`${baseUrl}/posts/${lateId}`, {
      method: 'PATCH',
      headers: LATE_HEADERS(token),
      body: JSON.stringify({ scheduledFor: new Date(newScheduledFor).toISOString(), isDraft: false }),
    });
    if (patchRes.ok) {
      return `https://getlate.dev/app/post/${lateId}`;
    }
  } catch {
    // Fall through to delete+recreate
  }

  // Fallback: GET original, POST new copy, DELETE old
  const getRes = await fetch(`${baseUrl}/posts/${lateId}`, {
    headers: LATE_HEADERS(token),
  });
  if (!getRes.ok) throw new Error(`Late GET ${getRes.status}`);
  const data = await getRes.json();
  const original = data.post || data;

  const cleanPlatforms = (original.platforms || []).map((p: Record<string, unknown>) => ({
    platform: p.platform || p.name || '',
    accountId: typeof p.accountId === 'object'
      ? ((p.accountId as Record<string, string>)?._id || (p.accountId as Record<string, string>)?.id || String(p.accountId))
      : (p.accountId || ''),
    ...(p.platformSpecificData ? { platformSpecificData: p.platformSpecificData } : {}),
  }));

  const newPost = {
    content: original.content || '',
    mediaItems: original.mediaItems || original.media || [],
    platforms: cleanPlatforms,
    scheduledFor: new Date(newScheduledFor).toISOString(),
    isDraft: false,
  };

  const createRes = await fetch(`${baseUrl}/posts`, {
    method: 'POST',
    headers: LATE_HEADERS(token),
    body: JSON.stringify(newPost),
  });
  if (!createRes.ok) throw new Error(`Late POST ${createRes.status}`);
  const created = await createRes.json();
  const newId = (created.post || created)._id || (created.post || created).id;

  try {
    await fetch(`${baseUrl}/posts/${lateId}`, {
      method: 'DELETE',
      headers: LATE_HEADERS(token),
    });
  } catch {
    console.warn(`[Late] Could not delete old post ${lateId}`);
  }

  return `https://getlate.dev/app/post/${newId}`;
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // CASCADE on social_post_media handles child rows automatically
    const { error } = await supabase
      .from('social_posts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[social-posts/[id]] Delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete social post' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error('[api/social-posts/[id]] DELETE Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete social post' },
      { status: 500 }
    );
  }
}
