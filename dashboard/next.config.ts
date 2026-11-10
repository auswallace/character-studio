import type { NextConfig } from "next";

// Storage host for next/image, derived from the env instead of hardcoded so a
// local Supabase (LaCie) or a new project works without a code change.
function storageHost(): string {
  try { return new URL(process.env.SUPABASE_URL || '').hostname; } catch { return ''; }
}
const host = storageHost();

const nextConfig: NextConfig = {
  // Allow long-running API routes (image generation can take 2+ min)
  // ffmpeg-static must be external so Next doesn't rewrite its binary path to /ROOT
  serverExternalPackages: ['ffmpeg-static', 'sharp'],
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    remotePatterns: host
      ? [{ protocol: host === 'localhost' || host === '127.0.0.1' ? 'http' : 'https', hostname: host, pathname: '/storage/v1/object/**' }]
      : [],
  },
  // Baseline hardening headers. No CSP yet: the UI uses inline styles everywhere,
  // so a CSP needs its own pass.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
      {
        // API responses are never cacheable by intermediaries and never embeddable
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
    ];
  },
};

export default nextConfig;
