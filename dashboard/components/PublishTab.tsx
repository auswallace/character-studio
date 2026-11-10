'use client';

import { useState, useEffect, useMemo } from 'react';
import PlatformIcon, { platformColors } from './PlatformIcon';
import PostEditorModal, { type PostImage } from './PostEditorModal';

// --- Types ---

interface SocialPost {
  id: string;
  status: string;
  image: string;
  imageThumbnail: string | null;
  images: PostImage[];
  video: string | null;
  platforms: string[];
  persona: string;
  captionIG: string;
  captionTwitter: string;
  captionTikTok: string;
  captionThreads: string;
  scheduledFor: string;
  scheduleMode: string;
  publishedUrls: string;
  error: string | null;
  title: string;
  notes: string;
  createdAt: string;
}

// Format a Date as YYYY-MM-DD using local timezone (avoids UTC shift from toISOString)
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Generate calendar days for a given month view
function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

// --- Loading Skeleton ---

function PostCardSkeleton() {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center gap-4 p-4 animate-pulse">
        <div className="w-14 h-14 rounded-lg flex-shrink-0" style={{ background: 'var(--color-bg-tertiary)' }} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-4 rounded w-32" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-3 rounded w-48" style={{ background: 'var(--color-bg-tertiary)' }} />
        </div>
        <div className="text-right flex-shrink-0 space-y-1">
          <div className="h-4 rounded w-20" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-3 rounded w-14 ml-auto" style={{ background: 'var(--color-bg-tertiary)' }} />
        </div>
        <div className="h-6 rounded-lg w-16 flex-shrink-0" style={{ background: 'var(--color-bg-tertiary)' }} />
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="rounded-xl border p-4 animate-pulse" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
      <div className="h-7 rounded w-8 mb-1" style={{ background: 'var(--color-bg-tertiary)' }} />
      <div className="h-3 rounded w-16" style={{ background: 'var(--color-bg-tertiary)' }} />
    </div>
  );
}

// --- Main Component ---

export default function PublishTab() {
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(() => new Date().getDate());
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    drafts: true,
    failed: true,
    scheduled: true,
    published: true,
  });
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPersona, setFilterPersona] = useState<string>('all');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [personaList, setPersonaList] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [editorPost, setEditorPost] = useState<SocialPost | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insightsStrategy, setInsightsStrategy] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // When a specific day is selected, expand all sections; when viewing full month, collapse them
  useEffect(() => {
    if (selectedDay !== null) {
      setCollapsedSections({ drafts: false, failed: false, scheduled: false, published: false });
    } else {
      setCollapsedSections({ drafts: true, failed: true, scheduled: true, published: true });
    }
  }, [selectedDay]);

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Dynamic month state
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Fetch posts + config (with optional sync first)
  const loadPosts = async (runSync = false) => {
    try {
      // Run Late sync before fetching if requested
      if (runSync) {
        setSyncing(true);
        try {
          const syncRes = await fetch('/api/social-posts/sync', { method: 'POST' });
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            if (syncData.synced > 0) {
              setSyncMessage(`${syncData.synced} post${syncData.synced > 1 ? 's' : ''} updated to Published`);
              setTimeout(() => setSyncMessage(null), 4000);
            }
          }
        } catch (err) {
          console.warn('[PublishTab] Sync failed (non-blocking):', err);
        } finally {
          setSyncing(false);
        }
      }

      const [postsRes, configRes] = await Promise.all([
        fetch('/api/social-posts?limit=100'),
        fetch('/api/config'),
      ]);
      if (!postsRes.ok) throw new Error(`Failed to fetch posts: ${postsRes.status}`);
      const postsData = await postsRes.json();
      const configData = await configRes.json();
      setPosts(postsData.posts ?? []);
      setPersonaList((configData.personas || []).map((p: { name: string }) => p.name));
    } catch (err) {
      console.error('Error fetching publish data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts(true); // Auto-sync with Late on page load to update publish statuses
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset day selection when changing months — auto-select today if viewing current month
  useEffect(() => {
    const now = new Date();
    if (calendarMonth.year === now.getFullYear() && calendarMonth.month === now.getMonth()) {
      setSelectedDay(now.getDate());
    } else {
      setSelectedDay(null);
    }
  }, [calendarMonth]);

  // Apply persona + platform filters to get the working set
  const filteredPosts = useMemo(() => {
    return posts.filter(p => {
      if (filterPersona !== 'all' && p.persona !== filterPersona) return false;
      if (filterPlatform !== 'all' && !p.platforms.some(
        pl => pl.toLowerCase() === filterPlatform.toLowerCase()
      )) return false;
      return true;
    });
  }, [posts, filterPersona, filterPlatform]);

  // --- KPI: Published (with time-range toggle) ---
  const [publishedRange, setPublishedRange] = useState<'7d' | '30d' | 'all'>('7d');

  const publishedCount = useMemo(() => {
    const now = Date.now();
    return filteredPosts.filter(p => {
      if (p.status.toLowerCase() !== 'published') return false;
      if (publishedRange === 'all') return true;
      if (!p.scheduledFor) return false;
      const postDate = new Date(p.scheduledFor).getTime();
      const days = publishedRange === '7d' ? 7 : 30;
      return postDate >= now - days * 24 * 60 * 60 * 1000;
    }).length;
  }, [filteredPosts, publishedRange]);

  // --- KPI: Scheduled (with per-platform breakdown) ---
  const scheduled = filteredPosts.filter(p => p.status.toLowerCase() === 'scheduled');

  const scheduledByPlatform = useMemo(() => {
    const counts: Record<string, number> = { Instagram: 0, Twitter: 0, TikTok: 0, Threads: 0 };
    for (const post of scheduled) {
      for (const plat of post.platforms) {
        if (plat in counts) counts[plat]++;
      }
    }
    return counts;
  }, [scheduled]);

  // --- KPI: Coverage (days until furthest scheduled post) ---
  const { coverageDays, coverageDate } = useMemo(() => {
    if (scheduled.length === 0) return { coverageDays: 0, coverageDate: '' };
    const latestTime = scheduled.reduce((max, p) => {
      const t = new Date(p.scheduledFor).getTime();
      return t > max ? t : max;
    }, 0);
    const days = Math.max(0, Math.ceil((latestTime - Date.now()) / (1000 * 60 * 60 * 24)));
    const dateStr = new Date(latestTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { coverageDays: days, coverageDate: dateStr };
  }, [scheduled]);

  // Dynamic calendar
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === calendarMonth.year && now.getMonth() === calendarMonth.month;
  const todayDate = isCurrentMonth ? now.getDate() : null;
  const calendarDays = getCalendarDays(calendarMonth.year, calendarMonth.month);
  const monthTitle = new Date(calendarMonth.year, calendarMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Group filtered posts by calendar day
  const calendarPostsByDay = useMemo(() => {
    const map: Record<number, SocialPost[]> = {};
    for (const post of filteredPosts) {
      if (!post.scheduledFor) continue;
      const d = new Date(post.scheduledFor);
      if (d.getFullYear() === calendarMonth.year && d.getMonth() === calendarMonth.month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(post);
      }
    }
    return map;
  }, [filteredPosts, calendarMonth]);

  // Filter to calendar month, then optionally by selected day
  const displayedPosts = useMemo(() => {
    return filteredPosts.filter(p => {
      if (!p.scheduledFor) {
        // Unscheduled (Draft) posts show when no specific day is selected
        return selectedDay === null;
      }
      const d = new Date(p.scheduledFor);
      // Always filter to the current calendar month
      if (d.getFullYear() !== calendarMonth.year || d.getMonth() !== calendarMonth.month) return false;
      // If a specific day is selected, narrow to that day
      if (selectedDay !== null && d.getDate() !== selectedDay) return false;
      return true;
    });
  }, [filteredPosts, selectedDay, calendarMonth]);

  const displayedScheduled = displayedPosts.filter(p => p.status.toLowerCase() === 'scheduled');
  const displayedDraft = displayedPosts.filter(p => {
    const s = p.status.toLowerCase();
    return s === 'draft' || s === 'ready' || s === 'pending captions';
  });
  const displayedFailed = displayedPosts.filter(p => p.status.toLowerCase() === 'failed');
  const displayedPublished = displayedPosts.filter(p => p.status.toLowerCase() === 'published');

  // Month navigation
  const prevMonth = () => setCalendarMonth(prev => {
    const d = new Date(prev.year, prev.month - 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const nextMonth = () => setCalendarMonth(prev => {
    const d = new Date(prev.year, prev.month + 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Platform list for legend
  const platforms = ['Instagram', 'Twitter', 'Threads', 'TikTok'];

  // --- Fetch AI Insights from Grok ---
  const fetchInsights = async () => {
    setInsightsLoading(true);
    try {
      const personaCounts: Record<string, number> = {};
      const platformCounts: Record<string, number> = {};
      const daysWithPosts = new Set<number>();

      for (const post of posts) {
        const p = post.persona || 'Unknown';
        personaCounts[p] = (personaCounts[p] || 0) + 1;
        for (const plat of (post.platforms || [])) {
          platformCounts[plat] = (platformCounts[plat] || 0) + 1;
        }
        if (post.scheduledFor) {
          const d = new Date(post.scheduledFor);
          if (d.getMonth() === calendarMonth.month && d.getFullYear() === calendarMonth.year) {
            daysWithPosts.add(d.getDate());
          }
        }
      }

      const total = posts.length || 1;
      const personaBalance: Record<string, number> = {};
      for (const [k, v] of Object.entries(personaCounts)) {
        personaBalance[k] = Math.round((v / total) * 100);
      }
      const contentMix: Record<string, number> = {};
      const platTotal = Object.values(platformCounts).reduce((a, b) => a + b, 0) || 1;
      for (const [k, v] of Object.entries(platformCounts)) {
        contentMix[k] = Math.round((v / platTotal) * 100);
      }
      const daysInMonth = new Date(calendarMonth.year, calendarMonth.month + 1, 0).getDate();
      const gapDays = daysInMonth - daysWithPosts.size;
      const monthName = new Date(calendarMonth.year, calendarMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      const res = await fetch('/api/social-posts/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stats: { totalPosts: posts.length, personaBalance, contentMix, gapDays, month: monthName }
        }),
      });
      const data = await res.json();
      setInsightsStrategy(data.strategy || 'No strategy available.');
    } catch {
      setInsightsStrategy('Unable to load strategy.');
    } finally {
      setInsightsLoading(false);
    }
  };

  // Compute insights stats from posts (for the cards)
  const insightsStats = useMemo(() => {
    const personaCounts: Record<string, number> = {};
    const platformCounts: Record<string, number> = {};
    const daysWithPosts = new Set<number>();

    for (const post of posts) {
      const p = post.persona || 'Unknown';
      personaCounts[p] = (personaCounts[p] || 0) + 1;
      for (const plat of (post.platforms || [])) {
        platformCounts[plat] = (platformCounts[plat] || 0) + 1;
      }
      if (post.scheduledFor) {
        const d = new Date(post.scheduledFor);
        if (d.getMonth() === calendarMonth.month && d.getFullYear() === calendarMonth.year) {
          daysWithPosts.add(d.getDate());
        }
      }
    }

    const total = posts.length || 1;
    const personaBalance: Record<string, number> = {};
    for (const [k, v] of Object.entries(personaCounts)) {
      personaBalance[k] = Math.round((v / total) * 100);
    }
    const contentMix: Record<string, number> = {};
    const platTotal = Object.values(platformCounts).reduce((a, b) => a + b, 0) || 1;
    for (const [k, v] of Object.entries(platformCounts)) {
      contentMix[k] = Math.round((v / platTotal) * 100);
    }
    const daysInMonth = new Date(calendarMonth.year, calendarMonth.month + 1, 0).getDate();
    const gapDays = daysInMonth - daysWithPosts.size;

    return { personaBalance, contentMix, gapDays };
  }, [posts, calendarMonth]);

  // Handle insights toggle — fetch on first open
  const handleInsightsToggle = () => {
    const willOpen = !insightsOpen;
    setInsightsOpen(willOpen);
    if (willOpen && insightsStrategy === null && !insightsLoading) {
      fetchInsights();
    }
  };

  return (
    <div className="space-y-8 fade-in">
      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        {loading ? (
          <><StatSkeleton /><StatSkeleton /><StatSkeleton /></>
        ) : (
          <>
            {/* Published */}
            <div className="rounded-xl border p-4" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
              <div className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-success)' }}>
                {publishedCount}
              </div>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>Published</div>
            </div>

            {/* Scheduled */}
            <div className="rounded-xl border p-4" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
              <div className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-green)' }}>
                {scheduled.length}
              </div>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>Scheduled</div>
            </div>

            {/* Coverage */}
            <div className="rounded-xl border p-4" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
              <div className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-info)' }}>
                {coverageDays}
              </div>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>Coverage</div>
            </div>
          </>
        )}
      </div>

      {/* Contribution Heatmap */}
      {!loading && <HeatmapCalendar posts={filteredPosts} />}

      {/* Persona + Platform Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Persona toggle */}
        <div className="flex items-center rounded-[20px] overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={() => setFilterPersona('all')}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: filterPersona === 'all' ? '#DBEAFE' : '#FFFFFF',
              color: filterPersona === 'all' ? '#1E40AF' : 'var(--color-text-secondary)',
            }}
          >
            All
          </button>
          {personaList.map(name => (
            <button
              key={name}
              onClick={() => setFilterPersona(filterPersona === name ? 'all' : name)}
              className="px-3 py-1.5 text-xs font-medium transition-colors border-l"
              style={{
                background: filterPersona === name ? '#DBEAFE' : '#FFFFFF',
                color: filterPersona === name ? '#1E40AF' : 'var(--color-text-secondary)',
                borderColor: 'var(--color-border)',
              }}
            >
              {name.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Platform filter */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setFilterPlatform('all')}
            className="px-2.5 py-1.5 rounded-[20px] text-xs font-medium transition-colors"
            style={{
              background: filterPlatform === 'all' ? '#DBEAFE' : 'transparent',
              color: filterPlatform === 'all' ? '#1E40AF' : 'var(--color-text-tertiary)',
              border: filterPlatform === 'all' ? '1px solid #BFDBFE' : '1px solid transparent',
            }}
          >
            All Platforms
          </button>
          {platforms.map(plat => {
            const isActive = filterPlatform.toLowerCase() === plat.toLowerCase();
            const color = platformColors[plat] || platformColors[plat.toLowerCase()] || '#666';
            return (
              <button
                key={plat}
                onClick={() => setFilterPlatform(isActive ? 'all' : plat)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[20px] text-xs font-medium transition-colors"
                style={{
                  background: isActive ? `${color}18` : 'transparent',
                  color: isActive ? color : 'var(--color-text-tertiary)',
                  border: isActive ? `1px solid ${color}40` : '1px solid transparent',
                }}
              >
                <PlatformIcon platform={plat} size={13} />
                {plat === 'Twitter' ? 'X' : plat}
              </button>
            );
          })}
        </div>

        {/* Active filter indicator */}
        {(filterPersona !== 'all' || filterPlatform !== 'all') && (
          <button
            onClick={() => { setFilterPersona('all'); setFilterPlatform('all'); }}
            className="text-[10px] font-medium px-2 py-1 rounded-md transition-colors"
            style={{ background: 'var(--color-error-muted)', color: 'var(--color-error)' }}
          >
            Clear Filters
          </button>
        )}

        {/* Sync Late button — pushed to far right */}
        <div className="flex items-center gap-2 ml-auto">
          {syncMessage && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-lg fade-in" style={{ background: 'var(--color-success-muted)', color: 'var(--color-success)' }}>
              {syncMessage}
            </span>
          )}
          <button
            onClick={() => loadPosts(true)}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[20px] text-xs font-medium transition-colors"
            style={{
              background: syncing ? 'var(--color-bg-tertiary)' : '#FFFFFF',
              color: syncing ? 'var(--color-text-tertiary)' : 'var(--color-accent-green)',
              border: '1px solid ' + (syncing ? 'var(--color-border)' : 'var(--color-accent-green)'),
              cursor: syncing ? 'not-allowed' : 'pointer',
            }}
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}
            >
              <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {syncing ? 'Syncing...' : 'Sync Late'}
          </button>
        </div>
      </div>

      {/* Calendar + AI Insights */}
      <div className="space-y-5">
        {/* Calendar View */}
        <section className="rounded-xl border p-5" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{monthTitle}</h2>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1.5 rounded-lg transition-colors hover:bg-black/5" style={{ color: 'var(--color-text-tertiary)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button onClick={nextMonth} className="p-1.5 rounded-lg transition-colors hover:bg-black/5" style={{ color: 'var(--color-text-tertiary)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-center text-[10px] font-medium uppercase tracking-wider py-1" style={{ color: 'var(--color-text-tertiary)' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} />;
              const dayPosts = calendarPostsByDay[day];
              const isToday = day === todayDate;
              const isSelected = day === selectedDay;
              const isPast = todayDate !== null && day < todayDate;

              // Collect unique platforms for this day
              const dayPlatforms = dayPosts
                ? [...new Set(dayPosts.flatMap(p => p.platforms))].slice(0, 4)
                : [];

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                  className="relative rounded-lg p-1.5 min-h-[60px] flex flex-col items-start transition-all duration-150 hover:bg-black/5"
                  style={{
                    background: isSelected ? 'var(--color-accent-green-muted)' : 'transparent',
                    border: isSelected ? '1px solid var(--color-accent-green)' : '1px solid transparent',
                    opacity: isPast ? 0.4 : 1,
                  }}
                >
                  <span className="flex items-center gap-1">
                    <span className={`text-xs ${isToday ? 'font-bold' : 'font-medium'}`} style={{ color: isSelected ? 'var(--color-accent-green)' : isToday ? 'var(--color-accent-green)' : 'var(--color-text-secondary)' }}>
                      {day}
                    </span>
                    {isToday && (
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent-green)' }} />
                    )}
                  </span>
                  {dayPlatforms.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {dayPlatforms.map(plat => (
                        <PlatformIcon key={plat} platform={plat} size={10} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            {platforms.map(name => (
              <div key={name} className="flex items-center gap-1.5">
                <PlatformIcon platform={name} size={12} />
                <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>{name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* AI Insights — Collapsible */}
        <section className="rounded-xl border overflow-hidden" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
          <button
            type="button"
            onClick={handleInsightsToggle}
            className="w-full flex items-center gap-2 p-5 text-left transition-colors"
            style={{ background: 'transparent' }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--color-accent-green-muted), var(--color-info-muted))' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.912 5.813a2 2 0 001.272 1.272L21 12l-5.816 1.915a2 2 0 00-1.272 1.272L12 21l-1.912-5.813a2 2 0 00-1.272-1.272L3 12l5.816-1.915a2 2 0 001.272-1.272L12 3z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold flex-1" style={{ fontFamily: 'var(--font-display)' }}>AI Insights</h3>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transition: 'transform 0.2s ease', transform: insightsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {insightsOpen && (
            <div className="px-5 pb-5 pt-0">
              {loading ? (
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Loading post data...</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Card 1 — Persona Balance */}
                  <div className="p-3 rounded-lg" style={{ background: 'var(--color-bg-tertiary)' }}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Persona Balance</span>
                    </div>
                    <div className="space-y-1.5">
                      {Object.keys(insightsStats.personaBalance).length === 0 ? (
                        <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>No posts yet</p>
                      ) : (
                        Object.entries(insightsStats.personaBalance).map(([name, pct], i) => (
                          <div key={name}>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span style={{ color: 'var(--color-text-secondary)' }}>{name}</span>
                              <span style={{ color: 'var(--color-text-tertiary)' }}>{pct}%</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-primary)' }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: i === 0 ? 'var(--color-accent-green)' : i === 1 ? 'var(--color-info)' : 'var(--color-warning)' }} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Card 2 — Gap Alert */}
                  <div className="p-3 rounded-lg" style={{ background: 'var(--color-error-muted)', border: '1px solid rgba(248, 113, 113, 0.15)' }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-error)' }}>Gap Alert</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      {insightsStats.gapDays === 0
                        ? 'Every day this month has at least one post scheduled. Great coverage!'
                        : `${insightsStats.gapDays} day${insightsStats.gapDays !== 1 ? 's' : ''} this month ${insightsStats.gapDays !== 1 ? 'have' : 'has'} no posts scheduled. Consistency keeps the algorithm active.`
                      }
                    </p>
                  </div>

                  {/* Card 3 — Content Mix */}
                  <div className="p-3 rounded-lg" style={{ background: 'var(--color-bg-tertiary)' }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-info)' }}>Content Mix</span>
                    </div>
                    {Object.keys(insightsStats.contentMix).length === 0 ? (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>No platform data yet</p>
                    ) : (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                        {Object.entries(insightsStats.contentMix).map(([plat, pct]) => `${plat}: ${pct}%`).join(', ')}
                      </p>
                    )}
                  </div>

                  {/* Card 4 — Strategy (Grok) */}
                  <div className="p-3 rounded-lg" style={{ background: 'var(--color-accent-green-muted)', border: '1px solid var(--color-accent-green-muted)' }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3l1.912 5.813a2 2 0 001.272 1.272L21 12l-5.816 1.915a2 2 0 00-1.272 1.272L12 21l-1.912-5.813a2 2 0 00-1.272-1.272L3 12l5.816-1.915a2 2 0 001.272-1.272L12 3z" />
                      </svg>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-green)' }}>Strategy</span>
                    </div>
                    {insightsLoading ? (
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent-green)', borderTopColor: 'transparent' }} />
                        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Generating strategy...</span>
                      </div>
                    ) : (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                        {insightsStrategy || 'Expand to generate strategy insights.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Filter indicator */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl" style={{ background: selectedDay !== null ? 'var(--color-accent-green-muted)' : 'var(--color-bg-tertiary)', border: selectedDay !== null ? '1px solid var(--color-accent-green)' : '1px solid var(--color-border)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={selectedDay !== null ? 'var(--color-accent-green)' : 'var(--color-text-tertiary)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="text-xs font-medium" style={{ color: selectedDay !== null ? 'var(--color-accent-green)' : 'var(--color-text-secondary)' }}>
          {selectedDay !== null
            ? `Showing posts for ${new Date(calendarMonth.year, calendarMonth.month, selectedDay).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            : `Showing ${monthTitle} posts`
          }
        </span>
        {selectedDay !== null && (
          <>
            <button
              type="button"
              onClick={() => {
                const dateStr = `${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
                window.location.hash = `publish.create?date=${dateStr}`;
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-[20px] text-xs font-medium transition-colors"
              style={{ background: '#FFFFFF', color: 'var(--color-accent-green)', border: '1px solid var(--color-accent-green)' }}
              title="Create new post for this day"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New
            </button>
            <button
              onClick={() => setSelectedDay(null)}
              className="text-xs font-medium px-2 py-0.5 rounded-md transition-colors"
              style={{ background: 'var(--color-accent-green)', color: '#fff' }}
            >
              Show All {monthTitle.split(' ')[0]}
            </button>
          </>
        )}
        <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
          {displayedScheduled.length} scheduled · {displayedDraft.length} drafts{displayedFailed.length > 0 ? ` · ${displayedFailed.length} failed` : ''}{displayedPublished.length > 0 ? ` · ${displayedPublished.length} published` : ''}
        </span>
      </div>

      {/* Drafts */}
      {loading ? (
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-green-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Drafts</h2>
          </div>
          <div className="space-y-3">
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        </section>
      ) : displayedDraft.length > 0 ? (
        <section>
          <div className="flex items-center gap-3 mb-4 cursor-pointer select-none" onClick={() => toggleSection('drafts')}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-green-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Drafts</h2>
            <span className="px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: 'var(--color-accent-green-muted)', color: 'var(--color-accent-green)' }}>{displayedDraft.length}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform duration-200" style={{ transform: collapsedSections.drafts ? 'rotate(0deg)' : 'rotate(180deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {!collapsedSections.drafts && (
            <div className="space-y-3">
              {displayedDraft.map((post) => (
                <PostCard key={post.id} post={post} expanded={expandedPost === post.id} onToggle={() => setExpandedPost(expandedPost === post.id ? null : post.id)} onEdit={() => setEditorPost(post)} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Failed */}
      {!loading && displayedFailed.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-4 cursor-pointer select-none" onClick={() => toggleSection('failed')}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-error-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Failed</h2>
            <span className="px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: 'var(--color-error-muted)', color: 'var(--color-error)' }}>{displayedFailed.length}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform duration-200" style={{ transform: collapsedSections.failed ? 'rotate(0deg)' : 'rotate(180deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          {!collapsedSections.failed && (
            <div className="space-y-3">
              {displayedFailed.map((post) => (
                <PostCard key={post.id} post={post} expanded={expandedPost === post.id} onToggle={() => setExpandedPost(expandedPost === post.id ? null : post.id)} onEdit={() => setEditorPost(post)} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Scheduled Queue */}
      <section>
        <div className="flex items-center gap-3 mb-4 cursor-pointer select-none" onClick={() => toggleSection('scheduled')}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-info-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Scheduled</h2>
          {!loading && (
            <span className="px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}>{displayedScheduled.length}</span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform duration-200" style={{ transform: collapsedSections.scheduled ? 'rotate(0deg)' : 'rotate(180deg)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {loading ? (
          <div className="space-y-3">
            <PostCardSkeleton />
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        ) : !collapsedSections.scheduled ? (
          <div className="space-y-3">
            {displayedScheduled.length > 0 ? (
              displayedScheduled.map((post) => (
                <PostCard key={post.id} post={post} expanded={expandedPost === post.id} onToggle={() => setExpandedPost(expandedPost === post.id ? null : post.id)} onEdit={() => setEditorPost(post)} />
              ))
            ) : (
              <div className="rounded-xl border p-8 text-center" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)' }}>
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  {selectedDay !== null ? 'No posts scheduled for this day.' : `No scheduled posts in ${monthTitle.split(' ')[0]}.`}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* Published */}
      {!loading && displayedPublished.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-4 cursor-pointer select-none" onClick={() => toggleSection('published')}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-success-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Published</h2>
            <span className="px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: 'var(--color-success-muted)', color: 'var(--color-success)' }}>{displayedPublished.length}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform duration-200" style={{ transform: collapsedSections.published ? 'rotate(0deg)' : 'rotate(180deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          {!collapsedSections.published && (
            <div className="space-y-3">
              {displayedPublished.map((post) => (
                <PostCard key={post.id} post={post} expanded={expandedPost === post.id} onToggle={() => setExpandedPost(expandedPost === post.id ? null : post.id)} onEdit={() => setEditorPost(post)} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Publish Action */}
      <div className="flex items-center gap-3 pt-2">
        <button
          className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'var(--color-accent-green)',
            color: '#ffffff',
            fontFamily: 'var(--font-display)',
            boxShadow: '0 0 24px var(--color-accent-green-muted), 0 1px 2px rgba(0,0,0,0.3)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          Publish All Drafts
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150"
          style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
        >
          Run Schedule Agent
        </button>
      </div>

      {/* Post Editor Modal */}
      {editorPost && (
        <PostEditorModal
          post={editorPost}
          onClose={() => setEditorPost(null)}
          onSaved={() => {
            setEditorPost(null);
            loadPosts(false);
          }}
          onDeleted={() => {
            setEditorPost(null);
            loadPosts(false);
          }}
        />
      )}
    </div>
  );
}

// --- Unified Heatmap Calendar ---

function HeatmapCalendar({ posts }: { posts: SocialPost[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toLocalDateStr(today);
  const year = today.getFullYear();
  const month = today.getMonth();

  // Build current month grid
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = firstOfMonth.getDay(); // 0=Sun

  const monthDates: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    monthDates.push(new Date(year, month, d));
  }

  // Group into weeks (Mon-start), pad with nulls
  const monStart = (startDow + 6) % 7; // 0=Mon, 6=Sun
  const weeks: (Date | null)[][] = [];
  let currentWeek: (Date | null)[] = [];

  for (let i = 0; i < monStart; i++) currentWeek.push(null);
  for (const date of monthDates) {
    currentWeek.push(date);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Count total posts per day (each platform entry counts as 1)
  const countsByDay = useMemo(() => {
    const result: Record<string, number> = {};
    for (const post of posts) {
      if (!post.scheduledFor) continue;
      const s = post.status.toLowerCase();
      if (s !== 'scheduled' && s !== 'published') continue;
      const key = post.scheduledFor.slice(0, 10);
      result[key] = (result[key] || 0) + post.platforms.length;
    }
    return result;
  }, [posts]);

  const accentColor = '#73877f';
  const getColor = (count: number): string => {
    if (count === 0) return 'var(--color-bg-tertiary)';
    if (count <= 2) return `${accentColor}35`;
    if (count <= 4) return `${accentColor}65`;
    if (count <= 6) return `${accentColor}95`;
    return `${accentColor}dd`;
  };

  const monthLabel = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const cellSize = 18;
  const cellGap = 3;

  return (
    <div className="rounded-xl border px-5 py-4" style={{ background: '#FFFFFF', borderColor: 'var(--color-border)', position: 'relative' }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 3v18" />
        </svg>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          {monthLabel}
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[9px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>Less</span>
          {[0, 1, 2, 3, 4].map(level => (
            <div key={level} className="rounded-sm" style={{
              width: 12, height: 12,
              background: level === 0 ? 'var(--color-bg-tertiary)' : `${accentColor}${level === 1 ? '35' : level === 2 ? '65' : level === 3 ? '95' : 'dd'}`,
            }} />
          ))}
          <span className="text-[9px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>More</span>
        </div>
      </div>

      {/* Unified grid */}
      <div className="flex" style={{ gap: cellGap }}>
        {/* Day labels */}
        <div className="flex flex-col" style={{ gap: cellGap, marginRight: 6 }}>
          {dayLabels.map((label, i) => (
            <div key={i} className="flex items-center justify-end text-[9px] font-medium"
              style={{ height: cellSize, color: 'var(--color-text-tertiary)' }}>
              {label}
            </div>
          ))}
        </div>
        {/* Week columns */}
        {weeks.map((week, wIdx) => (
          <div key={wIdx} className="flex flex-col flex-1" style={{ gap: cellGap }}>
            {week.map((date, dIdx) => {
              if (!date) {
                return <div key={dIdx} style={{ height: cellSize }} />;
              }
              const dateStr = toLocalDateStr(date);
              const count = countsByDay[dateStr] || 0;
              const isToday = dateStr === todayStr;
              const isPast = date < today;
              const dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

              return (
                <div
                  key={dIdx}
                  className="rounded cursor-default transition-all"
                  style={{
                    height: cellSize,
                    background: getColor(count),
                    outline: isToday ? `2px solid ${accentColor}` : 'none',
                    outlineOffset: '-1px',
                    opacity: isPast && count === 0 ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const parentRect = e.currentTarget.closest('[style*="position: relative"]')?.getBoundingClientRect();
                    if (parentRect) {
                      setTooltip({
                        x: rect.left - parentRect.left + rect.width / 2,
                        y: rect.top - parentRect.top - 4,
                        text: `${dateLabel}: ${count} post${count !== 1 ? 's' : ''}`,
                      });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Custom tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
            background: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, expanded, onToggle, onEdit }: {
  post: SocialPost;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const date = post.scheduledFor
    ? new Date(post.scheduledFor).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Not scheduled';
  const time = post.scheduledFor
    ? new Date(post.scheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  const statusLower = post.status.toLowerCase();
  const thumbnailSrc = post.imageThumbnail || post.image;

  return (
    <div
      className="rounded-xl border overflow-hidden transition-all duration-200"
      style={{
        background: '#FFFFFF',
        borderColor: expanded ? 'var(--color-border-hover)' : 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={onToggle}>
        {/* Thumbnail — click to open editor */}
        <div
          className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer transition-opacity hover:opacity-80"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnailSrc} alt="" className="w-full h-full object-cover" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{post.persona}</span>
            <div className="flex gap-1">
              {post.platforms.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: `${platformColors[p] || '#666'}15`, color: platformColors[p] || '#666' }}>
                  <PlatformIcon platform={p} size={10} />
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>{post.captionIG}</p>
        </div>

        {/* Date/Time */}
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{date}</div>
          {time && <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{time}</div>}
        </div>

        {/* Status */}
        <div className="flex-shrink-0">
          {statusLower === 'published' ? (
            <span className="px-2.5 py-1 rounded-[20px] text-xs font-medium" style={{ background: 'var(--color-success-muted)', color: 'var(--color-success)' }}>Published</span>
          ) : statusLower === 'scheduled' ? (
            <span className="px-2.5 py-1 rounded-[20px] text-xs font-medium" style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}>Scheduled</span>
          ) : statusLower === 'failed' ? (
            <span className="px-2.5 py-1 rounded-[20px] text-xs font-medium" style={{ background: 'var(--color-error-muted)', color: 'var(--color-error)' }}>Failed</span>
          ) : (
            <span className="px-2.5 py-1 rounded-[20px] text-xs font-medium" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'rgb(245, 158, 11)' }}>Draft</span>
          )}
        </div>

        {/* Late link */}
        {post.publishedUrls?.includes('getlate.dev') && (
          <a
            href={post.publishedUrls.match(/(https:\/\/getlate\.dev\/app\/post\/[a-f0-9]+)/i)?.[1] || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
            style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}
            onClick={(e) => e.stopPropagation()}
            title="View in Late"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}

        {/* Expand chevron */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t fade-in" style={{ borderColor: 'var(--color-border)' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            {post.captionIG && (
              <div>
                <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Instagram</label>
                <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}>{post.captionIG}</div>
              </div>
            )}
            {post.captionTwitter && (
              <div>
                <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Twitter / X</label>
                <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}>{post.captionTwitter}</div>
              </div>
            )}
            {post.captionThreads && (
              <div>
                <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Threads</label>
                <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}>{post.captionThreads}</div>
              </div>
            )}
            {post.captionTikTok && (
              <div>
                <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>TikTok</label>
                <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}>{post.captionTikTok}</div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="px-3 py-1.5 rounded-[20px] text-xs font-medium transition-colors hover:opacity-80"
              style={{ background: '#FFFFFF', color: 'var(--color-accent-green)', border: '1px solid var(--color-accent-green)' }}
            >
              Edit Post
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="px-3 py-1.5 rounded-[20px] text-xs font-medium transition-colors hover:opacity-80"
              style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
            >
              Reschedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
