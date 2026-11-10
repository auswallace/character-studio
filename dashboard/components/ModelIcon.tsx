'use client';

interface ModelIconProps {
  model: string;
  size?: number;
  style?: React.CSSProperties;
}

export default function ModelIcon({ model, size = 16, style }: ModelIconProps) {
  const normalized = model.toLowerCase();

  // Nanobanana 2 — four-pointed sparkle with teal/cyan gradient
  if (normalized.includes('nanobanana 2') || normalized.includes('nano banana 2')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} aria-label="Nanobanana 2">
        <defs>
          <linearGradient id="nano2-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06B6D4" />
            <stop offset="50%" stopColor="#14B8A6" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
        <path
          d="M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z"
          fill="url(#nano2-grad)"
        />
        <path
          d="M12 6 L13.2 10.8 L18 12 L13.2 13.2 L12 18 L10.8 13.2 L6 12 L10.8 10.8 Z"
          fill="white"
          opacity="0.35"
        />
      </svg>
    );
  }

  // Nanobanana Pro (Google Gemini) — four-pointed sparkle
  if (normalized.includes('nanobanana') || normalized.includes('nano')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} aria-label="Nanobanana Pro">
        <defs>
          <linearGradient id="nano-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4285F4" />
            <stop offset="33%" stopColor="#9B72CB" />
            <stop offset="66%" stopColor="#D96570" />
            <stop offset="100%" stopColor="#F4B400" />
          </linearGradient>
        </defs>
        <path
          d="M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z"
          fill="url(#nano-grad)"
        />
        <path
          d="M12 6 L13.2 10.8 L18 12 L13.2 13.2 L12 18 L10.8 13.2 L6 12 L10.8 10.8 Z"
          fill="white"
          opacity="0.35"
        />
      </svg>
    );
  }

  // Seedream 4.5 / 4.0 (ByteDance) — seed/sprout
  if (normalized.includes('seedream')) {
    const is45 = normalized.includes('4.5');
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} aria-label={`Seedream ${is45 ? '4.5' : '4.0'}`}>
        <defs>
          <linearGradient id="seed-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={is45 ? '#10B981' : '#6366F1'} />
            <stop offset="100%" stopColor={is45 ? '#34D399' : '#A78BFA'} />
          </linearGradient>
        </defs>
        {/* Seed body */}
        <ellipse cx="12" cy="15" rx="5" ry="6.5" fill="url(#seed-grad)" />
        {/* Sprout stem */}
        <path
          d="M12 9 C12 6 14 4 16 3"
          stroke={is45 ? '#34D399' : '#A78BFA'}
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
        {/* Sprout leaf */}
        <path
          d="M16 3 C14 3.5 13 5 12.5 6.5 C14 5 15.5 4 16 3 Z"
          fill={is45 ? '#34D399' : '#A78BFA'}
        />
        {/* Inner highlight */}
        <ellipse cx="11" cy="14" rx="2" ry="3" fill="white" opacity="0.15" />
      </svg>
    );
  }

  // Unknown model — no icon
  return null;
}
