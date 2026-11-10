'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { platformColors } from './PlatformIcon';

// --- Types ---

interface ScheduledPost {
  platforms: string[];
  scheduledFor: string;
}

interface ScheduleCalendarPopoverProps {
  value: string;                    // YYYY-MM-DD
  onChange: (date: string) => void;
}

// --- Helpers (mirrors PublishTab logic) ---

function getCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Component ---

export default function ScheduleCalendarPopover({ value, onChange }: ScheduleCalendarPopoverProps) {
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<ScheduledPost[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calendar month state — init from value or today
  const initDate = value ? new Date(value + 'T00:00:00') : new Date();
  const [calMonth, setCalMonth] = useState({ year: initDate.getFullYear(), month: initDate.getMonth() });

  // Fetch posts on first open
  useEffect(() => {
    if (!open || posts !== null) return;
    setLoading(true);
    fetch('/api/social-posts?limit=100')
      .then(r => r.json())
      .then(data => {
        const fetched: ScheduledPost[] = (data.posts || []).map((p: { platforms: string[]; scheduledFor: string }) => ({
          platforms: p.platforms || [],
          scheduledFor: p.scheduledFor || '',
        }));
        setPosts(fetched);
      })
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [open, posts]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Calendar data
  const now = new Date();
  const todayStr = toLocalDateStr(now);
  const isCurrentMonth = now.getFullYear() === calMonth.year && now.getMonth() === calMonth.month;
  const todayDate = isCurrentMonth ? now.getDate() : null;
  const calendarDays = getCalendarDays(calMonth.year, calMonth.month);
  const monthTitle = new Date(calMonth.year, calMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Group posts by day for the current calendar month
  const postsByDay = useMemo(() => {
    if (!posts) return {};
    const map: Record<number, string[]> = {}; // day -> unique platforms
    for (const post of posts) {
      if (!post.scheduledFor) continue;
      const d = new Date(post.scheduledFor);
      if (d.getFullYear() === calMonth.year && d.getMonth() === calMonth.month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        for (const plat of post.platforms) {
          if (!map[day].includes(plat)) map[day].push(plat);
        }
      }
    }
    return map;
  }, [posts, calMonth]);

  // Selected day derived from value prop
  const selectedDay = useMemo(() => {
    if (!value) return null;
    const d = new Date(value + 'T00:00:00');
    if (d.getFullYear() === calMonth.year && d.getMonth() === calMonth.month) {
      return d.getDate();
    }
    return null;
  }, [value, calMonth]);

  const prevMonth = useCallback(() => {
    setCalMonth(prev => {
      const d = new Date(prev.year, prev.month - 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  const nextMonth = useCallback(() => {
    setCalMonth(prev => {
      const d = new Date(prev.year, prev.month + 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  const handleDayClick = (day: number) => {
    const dateStr = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onChange(dateStr);
    setOpen(false);
  };

  // Format display value
  const displayText = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm outline-none transition-colors duration-200 min-w-[180px]"
        style={{
          background: 'var(--color-bg-surface)',
          borderColor: open ? 'var(--color-border-focus)' : 'var(--color-border)',
          color: value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {displayText || 'Pick a date...'}
        {value && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="ml-auto text-xs cursor-pointer"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            ✕
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute top-full left-0 mt-2 z-50 rounded-xl border shadow-lg p-4"
          style={{
            background: 'var(--color-bg-primary)',
            borderColor: 'var(--color-border)',
            width: '320px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}
        >
          {/* Month header */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg transition-colors hover:bg-black/5" style={{ color: 'var(--color-text-tertiary)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{monthTitle}</span>
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg transition-colors hover:bg-black/5" style={{ color: 'var(--color-text-tertiary)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="text-center text-[10px] font-medium uppercase tracking-wider py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-current/20 border-t-current rounded-full animate-spin" style={{ color: 'var(--color-accent-green)' }} />
            </div>
          )}

          {/* Calendar grid */}
          {!loading && (
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;

                const isToday = day === todayDate;
                const isSelected = day === selectedDay;
                const dayStr = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isPast = dayStr < todayStr;
                const dayPlatforms = postsByDay[day] || [];

                return (
                  <button
                    key={day}
                    type="button"
                    disabled={isPast}
                    onClick={() => handleDayClick(day)}
                    className="relative rounded-lg p-1 flex flex-col items-center transition-all duration-150 hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: isSelected ? 'var(--color-accent-green-muted)' : 'transparent',
                      border: isSelected ? '1px solid var(--color-accent-green)' : '1px solid transparent',
                      minHeight: '40px',
                    }}
                  >
                    <span className="flex items-center gap-0.5">
                      <span
                        className={`text-xs ${isToday ? 'font-bold' : 'font-medium'}`}
                        style={{
                          color: isSelected ? 'var(--color-accent-green)' : isToday ? 'var(--color-accent-green)' : 'var(--color-text-secondary)',
                        }}
                      >
                        {day}
                      </span>
                      {isToday && (
                        <span className="w-1 h-1 rounded-full" style={{ background: 'var(--color-accent-green)' }} />
                      )}
                    </span>
                    {dayPlatforms.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5">
                        {dayPlatforms.slice(0, 4).map(plat => (
                          <span
                            key={plat}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: platformColors[plat] || 'var(--color-text-tertiary)' }}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            {['Instagram', 'Twitter', 'TikTok', 'Threads'].map(name => (
              <div key={name} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: platformColors[name] || '#666' }} />
                <span className="text-[9px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>{name === 'Twitter' ? 'X' : name === 'Instagram' ? 'IG' : name === 'TikTok' ? 'TT' : 'TH'}</span>
              </div>
            ))}
            <span className="text-[9px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
              Empty = open slot
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
