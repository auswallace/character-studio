'use client';

import { useState, useEffect } from 'react';
import { Plus, RefreshCw, Send, Star } from 'lucide-react';

// --- TypeScript interfaces for API responses ---

interface Persona {
  id: string;
  name: string;
  faceRefs?: string[];
  [key: string]: unknown;
}

interface GenerationImage {
  url: string;
  thumbnails?: {
    large?: { url: string };
  };
}

interface Generation {
  id: string;
  name: string;
  persona: string;
  prompt: string;
  images: GenerationImage[];
  status: string;
  createdAt: string;
}

interface SocialPost {
  id: string;
  status: string;
  image: string;
  persona: string;
  platforms: string[];
  captionIG?: string;
  [key: string]: unknown;
}

interface HomeTabProps {
  onNavigate: (route: string) => void;
}

// --- Skeleton components ---

function SkeletonHero() {
  return (
    <div
      className="animate-pulse"
      style={{
        background: 'linear-gradient(135deg, #F5F5F5, #FAFAFA)',
        border: '1px solid var(--color-border)',
        borderRadius: 14,
        padding: '36px 32px',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-3">
          <div className="h-6 w-48 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-4 w-64 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-8 w-28 rounded-full mt-4" style={{ background: 'var(--color-bg-tertiary)' }} />
        </div>
        <div className="w-[200px] h-[120px] rounded-xl" style={{ background: 'var(--color-bg-tertiary)' }} />
      </div>
    </div>
  );
}

function SkeletonStats() {
  return (
    <div className="flex items-center gap-8 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-8">
          <div className="animate-pulse space-y-2">
            <div className="h-9 w-16 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
            <div className="h-3 w-20 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
          </div>
          {i < 3 && (
            <div style={{ width: 1, height: 48, background: 'rgba(0,0,0,0.08)' }} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function HomeTab({ onNavigate }: HomeTabProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [configRes, gensRes, postsRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/generations?limit=20'),
          fetch('/api/social-posts?limit=50'),
        ]);

        const [configData, gensData, postsData] = await Promise.all([
          configRes.json(),
          gensRes.json(),
          postsRes.json(),
        ]);

        setPersonas(configData.personas ?? []);
        setGenerations(gensData.generations ?? []);
        setPosts(postsData.posts ?? []);
      } catch (err) {
        console.error('HomeTab: failed to fetch data', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Compute stats from real data
  const totalGenerations = generations.length;
  const totalImages = generations.reduce((sum, g) => sum + (g.images?.length ?? 0), 0);
  const publishedCount = posts.filter(p => {
    const s = p.status?.toLowerCase() ?? '';
    return s === 'published' || s === 'sent' || s.includes('scheduled');
  }).length;
  const starredCount = generations.filter(g => (g as unknown as Record<string, unknown>).starred === true).length;

  // --- Loading state ---
  if (loading) {
    return (
      <div className="space-y-8 fade-in">
        <SkeletonHero />
        <SkeletonStats />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border p-5"
              style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px]" style={{ background: 'var(--color-bg-tertiary)' }} />
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
                  <div className="h-3 w-16 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Build recent activity from real data
  const recentActivity: {
    title: string;
    subtitle: string;
    timestamp: string;
    color: string;
  }[] = [];

  // Add recent generations
  generations.slice(0, 5).forEach(g => {
    const modelName = (g as unknown as Record<string, unknown>).model as string | undefined;
    const isNanobanana = modelName?.toLowerCase().includes('nanobanana');
    recentActivity.push({
      title: g.name || g.prompt?.slice(0, 50) || 'Generation',
      subtitle: `${g.persona ?? 'Unknown persona'} · ${g.images?.length ?? 0} images · ${modelName ?? 'Unknown model'}`,
      timestamp: g.createdAt ? formatTimeAgo(g.createdAt) : '',
      color: isNanobanana ? '#FACC15' : '#818CF8',
    });
  });

  // Add recent published posts
  posts.filter(p => p.status?.toLowerCase().includes('scheduled') || p.status?.toLowerCase() === 'published').slice(0, 3).forEach(p => {
    recentActivity.push({
      title: `Published to ${(p.platforms ?? []).join(', ') || 'social'}`,
      subtitle: `${p.persona ?? 'Unknown persona'} · ${p.status}`,
      timestamp: (p as unknown as Record<string, unknown>).created_at ? formatTimeAgo((p as unknown as Record<string, unknown>).created_at as string) : '',
      color: '#16A34A',
    });
  });

  // Sort by timestamp (most recent first) and limit
  const activityItems = recentActivity.slice(0, 6);


  const quickActions = [
    {
      label: 'New Generation',
      sublabel: 'Create AI images',
      route: 'studio.copy',
      icon: Plus,
      iconBg: '#D1FAE5',
      iconColor: '#16A34A',
    },
    {
      label: 'Remix',
      sublabel: 'Edit existing images',
      route: 'studio.remix',
      icon: RefreshCw,
      iconBg: '#DBEAFE',
      iconColor: '#3B82F6',
    },
    {
      label: 'Favorites',
      sublabel: 'Starred images',
      route: 'library',
      icon: Star,
      iconBg: '#FFD6E8',
      iconColor: '#DB2777',
    },
  ];

  const models = [
    {
      name: 'Nanobanana Pro',
      description: '4K photorealism, sync mode',
      gradient: 'linear-gradient(135deg, #FEF3C7, #FDE047, #FACC15)',
    },
    {
      name: 'Nanobanana 2',
      description: 'Fast generation, good quality',
      gradient: 'linear-gradient(135deg, #D1FAE5, #6EE7B7, #34D399)',
    },
    {
      name: 'Seedream 4.5',
      description: 'Style variety, async',
      gradient: 'linear-gradient(135deg, #E0E7FF, #A5B4FC, #818CF8)',
    },
    {
      name: 'Seedream 4',
      description: 'Classic model, reliable',
      gradient: 'linear-gradient(135deg, #DBEAFE, #93C5FD, #60A5FA)',
    },
  ];

  return (
    <div className="space-y-7 fade-in">
      {/* 1. Hero Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #F5F5F5, #FAFAFA)',
          border: '1px solid var(--color-border)',
          borderRadius: 14,
          overflow: 'hidden',
          height: 165,
        }}
      >
        <div className="flex items-start justify-between gap-6" style={{ height: '100%' }}>
          <div style={{ flexShrink: 0, padding: '14px 0 14px 28px', minWidth: 220 }}>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-display)',
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              Welcome to OXIRA.AI
            </h2>
            <p
              style={{
                fontSize: 11,
                color: '#888',
                marginTop: 2,
                lineHeight: 1.2,
              }}
            >
              Generate, remix, and publish.
            </p>
            <button
              onClick={() => onNavigate('studio.copy')}
              style={{
                marginTop: 6,
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-accent-green)',
                background: '#fff',
                border: '1.5px solid var(--color-accent-green)',
                borderRadius: 20,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-accent-green)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.color = 'var(--color-accent-green)';
              }}
            >
              Get Started
            </button>
          </div>
          <video
            src="/demo1.mp4"
            autoPlay
            loop
            muted
            playsInline
            style={{
              flex: 1,
              minWidth: 0,
              maxWidth: '55%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </div>
      </div>

      {/* 3. Quick Actions */}
      <div>
        <h3
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#999',
            letterSpacing: 1,
            textTransform: 'uppercase' as const,
            marginBottom: 12,
          }}
        >
          Quick Actions
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={() => onNavigate(action.route)}
                className="group"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 12,
                  padding: '20px 16px',
                  background: 'var(--color-bg-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  transition: 'all 0.15s ease',
                  textAlign: 'left' as const,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border-hover)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: action.iconBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={18} color={action.iconColor} strokeWidth={2} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-display)',
                    }}
                  >
                    {action.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {action.sublabel}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Image Models Available */}
      <div>
        <h3
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#999',
            letterSpacing: 1,
            textTransform: 'uppercase' as const,
            marginBottom: 12,
          }}
        >
          Image Models Available
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {models.map((model) => (
            <div
              key={model.name}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '16px',
                background: 'var(--color-bg-primary)',
                textAlign: 'center' as const,
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: 80,
                  borderRadius: 8,
                  background: model.gradient,
                  marginBottom: 12,
                }}
              />
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {model.name}
              </div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                {model.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Recent Activity */}
      {activityItems.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#999',
              letterSpacing: 1,
              textTransform: 'uppercase' as const,
              marginBottom: 12,
            }}
          >
            Recent Activity
          </h3>
          <div>
            {activityItems.map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 0',
                  borderBottom: i < activityItems.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}
              >
                {/* Vertical color bar */}
                <div
                  style={{
                    width: 4,
                    height: 36,
                    borderRadius: 2,
                    background: item.color,
                    flexShrink: 0,
                  }}
                />
                {/* Text content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--color-text-primary)',
                      whiteSpace: 'nowrap' as const,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {item.subtitle}
                  </div>
                </div>
                {/* Timestamp */}
                {item.timestamp && (
                  <div style={{ fontSize: 11, color: '#ccc', flexShrink: 0 }}>
                    {item.timestamp}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helper: format relative time ---
function formatTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
