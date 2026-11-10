'use client';

interface PlatformIconProps {
  platform: string;
  size?: number;
  style?: React.CSSProperties;
}

export default function PlatformIcon({ platform, size = 14, style }: PlatformIconProps) {
  const normalized = platform.toLowerCase();

  if (normalized === 'instagram') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
        <defs>
          <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
            <stop offset="0%" stopColor="#fdf497" />
            <stop offset="5%" stopColor="#fdf497" />
            <stop offset="45%" stopColor="#fd5949" />
            <stop offset="60%" stopColor="#d6249f" />
            <stop offset="90%" stopColor="#285AEB" />
          </radialGradient>
        </defs>
        <rect x="2" y="2" width="20" height="20" rx="6" stroke="url(#ig-grad)" strokeWidth="2" />
        <circle cx="12" cy="12" r="5" stroke="url(#ig-grad)" strokeWidth="2" />
        <circle cx="17.5" cy="6.5" r="1.5" fill="url(#ig-grad)" />
      </svg>
    );
  }

  if (normalized === 'twitter' || normalized === 'x') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color: '#000', ...style }}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }

  if (normalized === 'tiktok') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color: '#000', ...style }}>
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.46V13.2a8.16 8.16 0 004.77 1.53v-3.5a4.82 4.82 0 01-.8.07 4.83 4.83 0 01-2.84-.92v5.29a6.34 6.34 0 01-6.34 6.34" />
        <path d="M16.37 2h-3.45v.44a4.83 4.83 0 003.77 4.25 4.83 4.83 0 01-.32-4.69z" opacity="0.5" />
      </svg>
    );
  }

  if (normalized === 'threads') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color: '#000', ...style }}>
        <path d="M12.186 24h-.007C5.965 24 2.25 19.694 2.25 14.098v-.006c.033-5.598 3.81-9.842 9.942-9.842 2.628 0 4.77.71 6.372 2.112l-1.812 2.686c-1.14-.998-2.672-1.53-4.56-1.53-3.894 0-6.072 2.924-6.072 6.574 0 3.65 2.178 6.574 6.072 6.574 2.366 0 3.98-.904 4.764-2.292a4.16 4.16 0 00.528-1.898h-3.984v-3.12h7.776c.054.456.084.93.084 1.416 0 2.634-.72 4.734-2.082 6.066C17.886 22.83 15.492 24 12.186 24z" />
      </svg>
    );
  }

  // Fallback: colored dot
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--color-text-tertiary)',
        ...style,
      }}
    />
  );
}

// Platform colors map for badges/backgrounds
export const platformColors: Record<string, string> = {
  Instagram: '#E1306C',
  Twitter: '#000000',
  Threads: '#000000',
  TikTok: '#00f2ea',
};
