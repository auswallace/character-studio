import { NextRequest, NextResponse } from 'next/server';
import { supabase, apiKeys } from '@/lib/supabase';

const APIFY_API_KEY = apiKeys.apify || '';
const APIFY_ACTOR = 'apidojo~tweet-scraper';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { limit = 30, sort = 'Top' } = body;
    let { username } = body;

    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    // Clean username
    username = username.replace(/^@/, '').replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '').replace(/\/$/, '');

    // Step 1: Start Apify actor run (waitForFinish — blocks until done, up to 5 min)
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?waitForFinish=300`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${APIFY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          searchTerms: [`from:${username}`],
          maxTweets: limit,
          sort,
        }),
        signal: AbortSignal.timeout(360000),
      }
    );

    if (!runResponse.ok) {
      const errText = await runResponse.text();
      throw new Error(`Apify run failed: ${runResponse.status} — ${errText.substring(0, 200)}`);
    }

    const runData = await runResponse.json();
    const run = runData.data;

    if (run.status !== 'SUCCEEDED') {
      throw new Error(`Apify run ${run.status}: ${run.statusMessage || 'unknown error'}`);
    }

    const datasetId = run.defaultDatasetId;

    // Extract cost from run usage (Apify reports usageTotalUsd)
    const costUsd = run.usageTotalUsd || run.stats?.computeUnits || 0;

    // Step 2: Fetch results from dataset
    const dataResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${APIFY_API_KEY}` },
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!dataResponse.ok) {
      throw new Error(`Apify dataset fetch failed: ${dataResponse.status}`);
    }

    const items: Record<string, unknown>[] = await dataResponse.json();

    // Step 3: Extract photo tweets (same logic as x-reposter/scraper.js)
    interface ExtractedTweet {
      tweetId: string;
      sourceAccount: string;
      imageUrl: string;
      likes: number;
      retweets: number;
      views: number;
      bookmarks: number;
    }

    const tweets: ExtractedTweet[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if ((item as Record<string, unknown>).noResults) continue;

      const extMedia = (item as Record<string, unknown>).extendedEntities as Record<string, unknown> | undefined;
      const mediaArr = extMedia?.media as Record<string, unknown>[] | undefined;
      if (!Array.isArray(mediaArr) || mediaArr.length === 0) continue;

      const photos = mediaArr.filter((m: Record<string, unknown>) => m.type === 'photo');
      if (photos.length === 0) continue;

      // Verify author matches
      const author = (item as Record<string, unknown>).author as Record<string, unknown> | undefined;
      const authorName = (author?.userName as string || '').toLowerCase();
      if (authorName && authorName !== username.toLowerCase()) continue;

      const tweetId = String((item as Record<string, unknown>).id || '');
      if (!tweetId) continue;

      tweets.push({
        tweetId,
        sourceAccount: `@${author?.userName || username}`,
        imageUrl: `${photos[0].media_url_https}?name=large`,
        likes: (item as Record<string, unknown>).likeCount as number || 0,
        retweets: (item as Record<string, unknown>).retweetCount as number || 0,
        views: (item as Record<string, unknown>).viewCount as number || 0,
        bookmarks: (item as Record<string, unknown>).bookmarkCount as number || 0,
      });
    }

    // Step 4: Deduplicate against existing records
    const { data: existingRows } = await supabase
      .from('x_scraped_content')
      .select('original_tweet_id');

    const existingIds = new Set(
      (existingRows || []).map((r: { original_tweet_id: string }) => r.original_tweet_id)
    );
    const newTweets = tweets.filter(t => !existingIds.has(t.tweetId));

    // Step 5: Batch insert new tweets
    let created = 0;
    if (newTweets.length > 0) {
      const rows = newTweets.map(t => ({
        original_tweet_id: t.tweetId,
        source_account: t.sourceAccount,
        image_url: t.imageUrl,
        likes: t.likes,
        retweets: t.retweets,
        views: t.views,
        bookmarks: t.bookmarks,
        status: 'New',
        scraped_at: new Date().toISOString(),
      }));

      const { data, error } = await supabase
        .from('x_scraped_content')
        .insert(rows)
        .select('id');

      if (error) {
        console.error('[scrape-x] Batch insert failed:', error.message);
      } else {
        created = (data || []).length;
      }
    }

    // Step 6: Log scrape run cost
    await supabase.from('scrape_runs').insert({
      platform: 'x',
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
    console.error('[api/inspiration/scrape-x] POST Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'X scrape failed' },
      { status: 500 }
    );
  }
}
