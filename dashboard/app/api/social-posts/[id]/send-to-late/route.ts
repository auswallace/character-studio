import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/safe-url';
import { supabase, apiKeys } from '@/lib/supabase';
import sharp from 'sharp';

// --- Late account mappings ---
// Per-persona Late account IDs live in personas.late_accounts (JSONB,
// {"instagram": id, "threads": id, ...}). Edit them in Settings / the DB,
// not here. Migration: supabase/migrations/20261104_personas_late_accounts.sql

async function personaLateAccount(persona: string, latePlatform: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('personas')
    .select('late_accounts')
    .eq('name', persona)
    .maybeSingle<{ late_accounts: Record<string, string> | null }>();
  if (error) {
    console.warn(`[send-to-late] could not read late_accounts for "${persona}": ${error.message}`);
    return null;
  }
  return data?.late_accounts?.[latePlatform] || null;
}

function platformToLate(platform: string): string {
  const map: Record<string, string> = {
    Instagram: 'instagram',
    Twitter: 'twitter',
    TikTok: 'tiktok',
    Threads: 'threads',
  };
  return map[platform] || platform.toLowerCase();
}

const LATE_BASE = 'https://getlate.dev/api/v1';

const lateHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

// --- Supabase row shapes ---

interface SocialPostMediaRow {
  id: string;
  url: string;
  filename: string;
  media_type: string;
  sort_order: number | null;
}

interface SocialPostRow {
  id: string;
  status: string | null;
  persona: string | null;
  platforms: string[] | null;
  caption_instagram: string | null;
  caption_twitter: string | null;
  caption_tiktok: string | null;
  caption_threads: string | null;
  schedule_date: string | null;
  published_urls: string | null;
  social_post_media: SocialPostMediaRow[];
}

// --- Instagram aspect ratio fix (0.75:1 to 1.91:1) ---

const IG_MIN_RATIO = 0.7501;
const IG_MAX_RATIO = 1.91;

async function cropForInstagram(imageBytes: Uint8Array): Promise<{ buffer: Buffer; cropped: boolean }> {
  const meta = await sharp(imageBytes).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return { buffer: Buffer.from(imageBytes), cropped: false };

  const ratio = w / h;
  if (ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO) {
    return { buffer: Buffer.from(imageBytes), cropped: false };
  }

  let newW = w, newH = h;
  if (ratio < IG_MIN_RATIO) {
    // Too tall — crop height from center
    newH = Math.floor(w / IG_MIN_RATIO);
  } else {
    // Too wide — crop width from center
    newW = Math.floor(h * IG_MAX_RATIO);
  }

  const left = Math.floor((w - newW) / 2);
  const top = Math.floor((h - newH) / 2);

  const cropped = await sharp(imageBytes)
    .extract({ left, top, width: newW, height: newH })
    .jpeg({ quality: 95 })
    .toBuffer();

  console.log(`[send-to-late] Cropped ${w}x${h} (${ratio.toFixed(3)}) → ${newW}x${newH} (${(newW / newH).toFixed(3)}) for Instagram`);
  return { buffer: cropped, cropped: true };
}

// --- CDN upload (presign → PUT → permanent URL) ---

async function uploadToLateCDN(
  token: string,
  mediaUrl: string,
  forInstagram = false,
): Promise<string> {
  // Step 1: Download media (longer timeout for videos)
  const resp = await safeFetch(mediaUrl, { purpose: 'send-to-late media', signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`Failed to download media: ${resp.status}`);

  let mediaBytes = new Uint8Array(await resp.arrayBuffer());
  let mimeType = resp.headers.get('content-type') || 'application/octet-stream';

  const isVideo = mimeType.startsWith('video/');

  // Step 1.5: Crop for Instagram if needed (images only — skip for video)
  if (forInstagram && !isVideo) {
    const { buffer, cropped } = await cropForInstagram(mediaBytes);
    if (cropped) {
      mediaBytes = new Uint8Array(buffer);
      mimeType = 'image/jpeg'; // sharp outputs jpeg
    }
  }

  let ext: string;
  if (isVideo) {
    ext = mimeType === 'video/webm' ? 'webm' : mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  } else {
    ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  }
  const filename = `dash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;

  // Step 2: Get presigned upload URL
  const presignResp = await fetch(`${LATE_BASE}/media/presign`, {
    method: 'POST',
    headers: lateHeaders(token),
    body: JSON.stringify({ filename, contentType: mimeType, size: mediaBytes.length }),
    signal: AbortSignal.timeout(30000),
  });
  if (!presignResp.ok) {
    const errText = await presignResp.text();
    throw new Error(`Late presign failed: ${presignResp.status} — ${errText.substring(0, 200)}`);
  }

  const { uploadUrl, publicUrl } = await presignResp.json();

  // Step 3: PUT media to presigned URL (longer timeout for video)
  const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: mediaBytes,
    signal: AbortSignal.timeout(isVideo ? 300000 : 60000),
  });
  if (!uploadResp.ok) throw new Error(`Late CDN upload failed: ${uploadResp.status}`);

  return publicUrl;
}

// --- Resolve Late account ID for a platform + persona ---

async function resolveAccountId(
  token: string,
  latePlatform: string,
  persona: string,
): Promise<string | null> {
  // Persona-specific account (IG/Threads today; any platform if the persona row has it)
  const configured = await personaLateAccount(persona, latePlatform);
  if (configured) return configured;

  // For Twitter/TikTok, fetch from Late accounts list
  const resp = await fetch(`${LATE_BASE}/accounts`, {
    headers: lateHeaders(token),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Failed to fetch Late accounts: ${resp.status}`);
  const data = await resp.json();
  const accounts = data.accounts || data || [];

  for (const acc of accounts) {
    if ((acc.platform === latePlatform) && acc.isActive !== false) {
      return acc._id || acc.id;
    }
  }
  return null;
}

// --- Get platform-specific caption ---

function getCaptionForPlatform(row: SocialPostRow, platform: string): string {
  switch (platform) {
    case 'Instagram': return row.caption_instagram || '';
    case 'Twitter': return row.caption_twitter || '';
    case 'TikTok': return row.caption_tiktok || '';
    case 'Threads': return row.caption_threads || '';
    default: return '';
  }
}

// --- Main handler ---

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const lateToken = apiKeys.late as string | undefined;
  if (!lateToken) {
    return NextResponse.json({ error: 'Late API key not configured' }, { status: 500 });
  }

  try {
    const { id } = await params;

    // Fetch the full post from Supabase (with media)
    const { data: row, error: fetchErr } = await supabase
      .from('social_posts')
      .select('*, social_post_media(*)')
      .eq('id', id)
      .single();

    if (fetchErr || !row) {
      return NextResponse.json(
        { error: fetchErr?.message || 'Post not found' },
        { status: 404 }
      );
    }

    const post = row as SocialPostRow;
    const platforms = post.platforms || [];
    const persona = post.persona || '';
    const scheduleDate = post.schedule_date || '';

    const media = (post.social_post_media || []).sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
    const images = media.filter(m => m.media_type === 'image');
    const videos = media.filter(m => m.media_type === 'video');

    if (platforms.length === 0) {
      return NextResponse.json({ error: 'No platforms selected on this post' }, { status: 400 });
    }
    if (images.length === 0 && videos.length === 0) {
      return NextResponse.json({ error: 'No images or videos attached to this post' }, { status: 400 });
    }

    // Upload images/videos per platform (Instagram needs aspect ratio crop)
    // Cache non-IG uploads so we don't re-upload for Twitter/Threads
    const cdnCache: Record<string, string> = {};
    const igCdnCache: Record<string, string> = {};

    async function getMediaForPlatform(platform: string): Promise<{ type: string; url: string }[]> {
      const isIG = platform === 'Instagram';
      const cache = isIG ? igCdnCache : cdnCache;
      const items: { type: string; url: string }[] = [];

      if (platform === 'TikTok') {
        for (const vid of videos) {
          if (!cache[vid.url]) {
            cache[vid.url] = await uploadToLateCDN(lateToken!, vid.url);
          }
          items.push({ type: 'video', url: cache[vid.url] });
        }
        return items;
      }

      for (const img of images) {
        if (!cache[img.url]) {
          cache[img.url] = await uploadToLateCDN(lateToken!, img.url, isIG);
        }
        items.push({ type: 'image', url: cache[img.url] });
      }
      for (const vid of videos) {
        if (!cache[vid.url]) {
          cache[vid.url] = await uploadToLateCDN(lateToken!, vid.url);
        }
        items.push({ type: 'video', url: cache[vid.url] });
      }
      return items;
    }

    // Create a Late post per platform
    const publishedUrls: string[] = [];
    const errors: string[] = [];

    for (const platform of platforms) {
      const latePlatform = platformToLate(platform);
      const accountId = await resolveAccountId(lateToken, latePlatform, persona);

      if (!accountId) {
        errors.push(`${platform}: no Late account found`);
        continue;
      }

      const caption = getCaptionForPlatform(post, platform);
      const platformMedia = await getMediaForPlatform(platform);

      if (platformMedia.length === 0) {
        errors.push(`${platform}: no compatible media`);
        continue;
      }

      const platformEntry: Record<string, unknown> = {
        platform: latePlatform,
        accountId,
      };

      // Instagram: publish as Reel when video is present
      const hasVideo = platformMedia.some(m => m.type === 'video');
      if (latePlatform === 'instagram' && hasVideo) {
        platformEntry.platformSpecificData = {
          contentType: 'reels',
          shareToFeed: true,
        };
      }

      // TikTok-specific settings
      if (latePlatform === 'tiktok') {
        platformEntry.platformSpecificData = {
          tiktokSettings: {
            privacy_level: 'PUBLIC_TO_EVERYONE',
            allow_comment: true,
            allow_duet: true,
            allow_stitch: true,
          },
        };
      }

      const postData: Record<string, unknown> = {
        content: caption,
        mediaItems: platformMedia,
        platforms: [platformEntry],
        isDraft: false,
      };

      // Schedule or publish now
      if (scheduleDate) {
        const schedDate = new Date(scheduleDate);
        if (schedDate.getTime() > Date.now()) {
          postData.scheduledFor = schedDate.toISOString();
        } else {
          postData.publishNow = true;
        }
      } else {
        postData.publishNow = true;
      }

      try {
        const createResp = await fetch(`${LATE_BASE}/posts`, {
          method: 'POST',
          headers: lateHeaders(lateToken),
          body: JSON.stringify(postData),
          signal: AbortSignal.timeout(30000),
        });

        if (!createResp.ok) {
          const errText = await createResp.text();
          errors.push(`${platform}: Late API ${createResp.status} — ${errText.substring(0, 100)}`);
          continue;
        }

        const result = await createResp.json();
        const postResult = result.post || result;
        const latePostId = postResult._id || postResult.id || '';

        if (latePostId) {
          publishedUrls.push(`${platform}: https://getlate.dev/app/post/${latePostId}`);
        } else {
          publishedUrls.push(`${platform}: published`);
        }
      } catch (err) {
        errors.push(`${platform}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    // Write Late URLs back to Supabase
    const updateFields: Record<string, string | null> = {};

    if (publishedUrls.length > 0) {
      // Merge with any existing published_urls
      const existing = post.published_urls || '';
      const allUrls = existing
        ? `${existing}\n${publishedUrls.join('\n')}`
        : publishedUrls.join('\n');
      updateFields.published_urls = allUrls;
      updateFields.status = 'Scheduled';
      updateFields.error = null; // clear any previous error
    }

    if (errors.length > 0 && publishedUrls.length === 0) {
      updateFields.status = 'Failed';
      updateFields.error = errors.join('; ');
    }

    if (Object.keys(updateFields).length > 0) {
      await supabase
        .from('social_posts')
        .update(updateFields)
        .eq('id', id);
    }

    return NextResponse.json({
      success: publishedUrls.length > 0,
      publishedUrls,
      errors,
    });
  } catch (error) {
    console.error('[api/social-posts/[id]/send-to-late] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send to Late' },
      { status: 500 },
    );
  }
}
