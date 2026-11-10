import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/safe-url';

/**
 * Proxy images that fail CORS (e.g. raw Instagram CDN URLs).
 * Usage: /api/inspiration/image-proxy?url=https://scontent-...
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  // Hostname allowlist (not substring: "evil.com/?x=twimg.com" used to pass). See lib/safe-url.ts
  try {
    const res = await safeFetch(url, {
      purpose: 'image-proxy',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'UnsafeUrlError') {
      return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Proxy fetch failed' }, { status: 502 });
  }
}
