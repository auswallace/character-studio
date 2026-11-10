import { NextResponse } from 'next/server';
import { supabase, apiKeys } from '@/lib/supabase';

const LATE_BASE_URL = 'https://getlate.dev/api/v1';
const LATE_POST_ID_REGEX = /getlate\.dev\/app\/post\/([a-f0-9]+)/gi;

// Matches lines like "Instagram: published" (CLI social-manager format)
const PLATFORM_PUBLISHED_REGEX = /^(Instagram|Twitter|Threads|TikTok):\s*published$/i;

/**
 * POST /api/social-posts/sync
 *
 * Syncs Late publish status back to Supabase.
 * Two modes:
 * 1. Records with Late post URLs → queries Late API to confirm published
 * 2. Records with "platform: published" entries (from CLI) → marks Published directly
 */
export async function POST() {
  const lateToken = apiKeys.late;
  if (!lateToken) {
    console.error('[sync] No Late API key found in environment');
    return NextResponse.json(
      { error: 'Late API key not configured' },
      { status: 500 }
    );
  }

  try {
    // Fetch all "Scheduled" records from Supabase
    const { data: records, error: fetchErr } = await supabase
      .from('social_posts')
      .select('id, status, published_urls')
      .eq('status', 'Scheduled');

    if (fetchErr) {
      throw new Error(`Supabase query failed: ${fetchErr.message}`);
    }

    const rows = records || [];
    console.log(`[sync] Found ${rows.length} scheduled records to check`);

    let synced = 0;
    let checked = 0;
    let skipped = 0;

    for (const record of rows) {
      const publishedUrls = record.published_urls || '';

      // Extract Late post IDs from published_urls
      const lateIds: string[] = [];
      let match: RegExpExecArray | null;
      // Reset regex lastIndex for each record
      LATE_POST_ID_REGEX.lastIndex = 0;
      while ((match = LATE_POST_ID_REGEX.exec(publishedUrls)) !== null) {
        lateIds.push(match[1]);
      }

      if (lateIds.length === 0) {
        // Check for CLI-style "platform: published" entries
        const lines = publishedUrls.split('\n').filter(Boolean);
        const allLinesPublished = lines.length > 0 && lines.every(
          (line: string) => PLATFORM_PUBLISHED_REGEX.test(line.trim())
        );

        if (allLinesPublished) {
          await supabase
            .from('social_posts')
            .update({ status: 'Published' })
            .eq('id', record.id);
          synced++;
          console.log(`[sync] Updated ${record.id} → Published (CLI-confirmed: ${lines.length} platforms)`);
        } else {
          skipped++;
        }
        continue;
      }

      checked++;

      // Check each Late post — ALL must be published for us to mark as Published
      let allPublished = true;

      for (const lateId of lateIds) {
        try {
          const res = await fetch(`${LATE_BASE_URL}/posts/${lateId}`, {
            headers: { Authorization: `Bearer ${lateToken}` },
          });

          if (!res.ok) {
            console.warn(`[sync] Late API ${res.status} for post ${lateId} — skipping record ${record.id}`);
            allPublished = false;
            break;
          }

          const data = await res.json();
          const status = data.status || data.post?.status || '';

          if (status.toLowerCase() !== 'published') {
            allPublished = false;
            break;
          }
        } catch (err) {
          console.warn(`[sync] Late API error for post ${lateId}:`, err);
          allPublished = false;
          break;
        }
      }

      if (allPublished) {
        await supabase
          .from('social_posts')
          .update({ status: 'Published' })
          .eq('id', record.id);

        synced++;
        console.log(`[sync] Updated ${record.id} → Published (${lateIds.length} Late posts confirmed)`);
      }
    }

    console.log(`[sync] Done: ${synced} synced, ${checked} checked, ${skipped} skipped (no Late IDs), ${rows.length} total`);

    return NextResponse.json({
      synced,
      checked,
      skipped,
      total: rows.length,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[sync] Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
