import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/safe-url';
import { supabase, apiKeys } from '@/lib/supabase';

const APIFY_API_KEY = apiKeys.apify || '';
const APIFY_ACTOR = 'apify~instagram-post-scraper';

export const maxDuration = 300; // Allow up to 5 min for Apify polling

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { limit = 20 } = body;
    let { username } = body;

    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    // Clean username — handle full URLs or @-prefix
    username = username
      .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
      .replace(/\/$/, '')
      .replace(/^@/, '');

    // Step 1: Start Apify actor run
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${APIFY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: [username],
          resultsLimit: limit * 5, // Fetch 5x more to account for video-heavy accounts — we filter to image posts only
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!runResponse.ok) {
      const errText = await runResponse.text();
      throw new Error(`Apify run failed: ${runResponse.status} — ${errText.substring(0, 200)}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    // Step 2: Poll for completion (up to 5 minutes)
    const MAX_WAIT = 300000;
    const POLL_INTERVAL = 5000;
    const startTime = Date.now();

    let completed = false;
    while (Date.now() - startTime < MAX_WAIT) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      const statusResp = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}`,
        {
          headers: { 'Authorization': `Bearer ${APIFY_API_KEY}` },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!statusResp.ok) continue;
      const statusData = await statusResp.json();
      const status = statusData.data.status;

      if (status === 'SUCCEEDED') {
        completed = true;
        break;
      }
      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`Apify run ${status}: ${statusData.data.statusMessage || 'unknown error'}`);
      }
    }

    // Fetch run details for cost
    let costUsd = 0;
    try {
      const runDetailResp = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}`,
        { headers: { 'Authorization': `Bearer ${APIFY_API_KEY}` }, signal: AbortSignal.timeout(15000) }
      );
      if (runDetailResp.ok) {
        const runDetail = await runDetailResp.json();
        costUsd = runDetail.data?.usageTotalUsd || 0;
      }
    } catch { /* ignore cost fetch errors */ }

    if (!completed) {
      throw new Error('Apify run timed out after 5 minutes');
    }

    // Step 3: Fetch results from dataset
    const dataResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=${limit * 5}`,
      {
        headers: { 'Authorization': `Bearer ${APIFY_API_KEY}` },
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!dataResponse.ok) {
      throw new Error(`Apify dataset fetch failed: ${dataResponse.status}`);
    }

    const items: Record<string, unknown>[] = await dataResponse.json();

    // Step 4: Extract posts (skip videos, handle carousels)
    interface ExtractedPost {
      imageUrls: string[];
      caption: string;
      likes: number;
      views: number;
      postDate: string | null;
      postUrl: string | null;
      username: string;
    }

    const posts: ExtractedPost[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      // Skip pure video posts (Reels) — but allow carousels that contain images
      if (item.type === 'Video') continue;

      const postUrl = item.shortCode
        ? `https://www.instagram.com/p/${item.shortCode}/`
        : (item.url as string) || null;

      // Extract image URLs — handle carousels (Sidecar) and single image posts
      const imageUrls: string[] = [];

      // Carousel posts: Apify may use childPosts or images array
      const children = (item.childPosts || item.images || item.sidecarImages) as Record<string, unknown>[] | undefined;
      if ((item.type === 'Sidecar' || item.type === 'Carousel') && Array.isArray(children) && children.length > 0) {
        for (const child of children) {
          if (child.type === 'Video') continue;
          // Apify uses displayUrl or url depending on version
          const childUrl = (child.displayUrl || child.url || child.src) as string | undefined;
          if (childUrl) imageUrls.push(childUrl);
        }
      }

      // Fallback: single image post or carousel with no children parsed
      if (imageUrls.length === 0 && item.displayUrl) {
        imageUrls.push(item.displayUrl as string);
      }
      if (imageUrls.length === 0) continue;

      let postDate: string | null = null;
      if (item.timestamp) {
        try {
          postDate = new Date(item.timestamp as string).toISOString().split('T')[0];
        } catch {
          // Skip invalid dates
        }
      }

      posts.push({
        imageUrls,
        caption: ((item.caption as string) || '').substring(0, 5000),
        likes: typeof item.likesCount === 'number' ? item.likesCount : 0,
        views: typeof item.videoViewCount === 'number' ? item.videoViewCount : 0,
        postDate,
        postUrl,
        username,
      });

      // Stop once we have enough image posts
      if (posts.length >= limit) break;
    }

    // Step 5: Deduplicate against existing records
    const { data: existingRows, error: dedupErr } = await supabase
      .from('scraped_posts')
      .select('post_url');

    if (dedupErr) {
      console.error('[scrape] Dedup query failed:', dedupErr.message);
    }

    const existingUrls = new Set(
      (existingRows || []).map((r: { post_url: string | null }) => r.post_url).filter(Boolean)
    );
    const newPosts = posts.filter(p => p.postUrl && !existingUrls.has(p.postUrl));

    // Step 6: Create Supabase records
    let created = 0;
    for (const post of newPosts) {
      try {
        // Insert the scraped_posts row
        const { data: insertedPost, error: postErr } = await supabase
          .from('scraped_posts')
          .insert({
            username: post.username,
            caption: post.caption,
            likes: post.likes,
            views: post.views,
            post_date: post.postDate,
            post_url: post.postUrl,
          })
          .select('id')
          .single();

        if (postErr || !insertedPost) {
          console.error(`[scrape] Failed to insert post ${post.postUrl}:`, postErr?.message);
          continue;
        }

        // Download images and upload to Supabase Storage for permanent access
        // (Instagram CDN URLs expire after the scraping session ends)
        if (post.imageUrls.length > 0) {
          const imageRows: { post_id: string; url: string; storage_path: string; sort_order: number }[] = [];

          for (let idx = 0; idx < post.imageUrls.length; idx++) {
            const cdnUrl = post.imageUrls[idx];
            const storagePath = `ig/${post.username}/${insertedPost.id}_${idx}.jpg`;
            let finalUrl = cdnUrl; // fallback to CDN URL if upload fails

            try {
              // Download from Instagram CDN
              const imgRes = await safeFetch(cdnUrl, { purpose: 'scraped image' });
              if (imgRes.ok) {
                const buffer = Buffer.from(await imgRes.arrayBuffer());

                // Upload to Supabase Storage (scraped-content bucket)
                const { error: uploadErr } = await supabase.storage
                  .from('scraped-content')
                  .upload(storagePath, buffer, {
                    contentType: 'image/jpeg',
                    upsert: true,
                  });

                if (!uploadErr) {
                  const { data: publicUrl } = supabase.storage
                    .from('scraped-content')
                    .getPublicUrl(storagePath);
                  finalUrl = publicUrl.publicUrl;
                } else {
                  console.warn(`[scrape] Upload failed for ${storagePath}: ${uploadErr.message}`);
                }
              } else {
                console.warn(`[scrape] Failed to download image ${idx} for post ${insertedPost.id}: HTTP ${imgRes.status}`);
              }
            } catch (dlErr) {
              console.warn(`[scrape] Image download error for post ${insertedPost.id} image ${idx}:`, dlErr);
            }

            imageRows.push({
              post_id: insertedPost.id,
              url: finalUrl,
              storage_path: storagePath,
              sort_order: idx,
            });
          }

          const { error: imgErr } = await supabase
            .from('scraped_post_images')
            .insert(imageRows);

          if (imgErr) {
            console.error(`[scrape] Failed to insert images for post ${insertedPost.id}:`, imgErr.message);
          }
        }

        created++;
      } catch (err) {
        console.error(`[scrape] Error creating post:`, err);
      }
    }

    // Log scrape run cost
    await supabase.from('scrape_runs').insert({
      platform: 'ig',
      username,
      posts_scraped: created,
      cost_usd: costUsd,
    });

    return NextResponse.json({
      scraped: items.length,
      new: created,
      username,
      cost_usd: costUsd,
    });
  } catch (error) {
    console.error('[api/inspiration/scrape] POST Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scrape failed' },
      { status: 500 }
    );
  }
}
