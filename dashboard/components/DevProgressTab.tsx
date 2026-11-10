'use client';

import { useState, useEffect, useMemo } from 'react';
import TicketPanel from './TicketPanel';

// ─── Types ──────────────────────────────────────────────────────

type Category = 'feature' | 'fix' | 'backlog';

interface ProgressItem {
  name: string;
  description: string;
  category: Category;
}

interface Session {
  number: number;
  title: string;
  items: ProgressItem[];
}

interface DayGroup {
  date: string;
  sessions: Session[];
}

interface ProgressStats {
  totalSessions: number;
  totalFeatures: number;
  totalFixes: number;
  totalBacklog: number;
  activeDays: number;
}

interface ProgressData {
  days: DayGroup[];
  stats: ProgressStats;
}

// ─── Constants ──────────────────────────────────────────────────

const CATEGORY_COLORS: Record<Category, string> = {
  feature: 'var(--color-accent-green)',
  fix: '#d97706',
  backlog: '#94a3b8',
};

const CATEGORY_LABELS: Record<Category, string> = {
  feature: 'Feature',
  fix: 'Fix',
  backlog: 'Backlog',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-');
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${MONTHS[monthIdx]} ${day}`;
}

function formatDateFull(dateStr: string): string {
  const parts = dateStr.split('-');
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const year = parts[0];
  return `${MONTHS[monthIdx]} ${day}, ${year}`;
}

// ─── Stat Card ──────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-1"
      style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)' }}
    >
      <span
        className="text-2xl font-bold tabular-nums"
        style={{ color: color || 'var(--color-text-primary)', fontFamily: 'var(--font-mono, monospace)' }}
      >
        {value}
      </span>
      <span
        className="text-xs uppercase tracking-wider"
        style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Stacked Bar Chart ──────────────────────────────────────────

function StackedBarChart({
  days,
  selectedDate,
  onSelectDate,
}: {
  days: DayGroup[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  const dayCounts = useMemo(() => {
    return days.map((day) => {
      let features = 0;
      let fixes = 0;
      let backlog = 0;
      for (const session of day.sessions) {
        for (const item of session.items) {
          if (item.category === 'feature') features++;
          else if (item.category === 'fix') fixes++;
          else backlog++;
        }
      }
      return { date: day.date, features, fixes, backlog, total: features + fixes + backlog };
    });
  }, [days]);

  const maxTotal = Math.max(...dayCounts.map((d) => d.total), 1);

  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
        >
          Activity by Day
        </span>
        <div className="flex items-center gap-3">
          {(['feature', 'fix', 'backlog'] as Category[]).map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ background: CATEGORY_COLORS[cat] }}
              />
              <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                {CATEGORY_LABELS[cat] === 'Fix' ? 'Fixes' : CATEGORY_LABELS[cat] + 's'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-1.5" style={{ height: 140 }}>
        {dayCounts.map((day) => {
          const isSelected = selectedDate === day.date;
          const barHeight = Math.max((day.total / maxTotal) * 120, 4);
          const featureH = day.total > 0 ? (day.features / day.total) * barHeight : 0;
          const fixH = day.total > 0 ? (day.fixes / day.total) * barHeight : 0;
          const backlogH = day.total > 0 ? (day.backlog / day.total) * barHeight : 0;

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center cursor-pointer group"
              onClick={() => onSelectDate(isSelected ? null : day.date)}
            >
              <div
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] mb-1 whitespace-nowrap pointer-events-none"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {day.total} items
              </div>

              <div
                className="w-full rounded-t-sm flex flex-col-reverse overflow-hidden transition-all"
                style={{
                  height: barHeight,
                  outline: isSelected ? `2px solid var(--color-accent-green)` : 'none',
                  outlineOffset: 1,
                  borderRadius: 4,
                  opacity: selectedDate && !isSelected ? 0.35 : 1,
                }}
              >
                {backlogH > 0 && (
                  <div style={{ height: backlogH, background: CATEGORY_COLORS.backlog }} />
                )}
                {fixH > 0 && (
                  <div style={{ height: fixH, background: CATEGORY_COLORS.fix }} />
                )}
                {featureH > 0 && (
                  <div style={{ height: featureH, background: CATEGORY_COLORS.feature }} />
                )}
              </div>

              <span
                className="text-[10px] mt-1.5 tabular-nums"
                style={{
                  color: isSelected ? 'var(--color-accent-green)' : 'var(--color-text-secondary)',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                {formatDate(day.date)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Filter Bar ─────────────────────────────────────────────────

function FilterBar({
  activeCategories,
  onToggleCategory,
  selectedDate,
  onClearDate,
}: {
  activeCategories: Set<Category>;
  onToggleCategory: (cat: Category) => void;
  selectedDate: string | null;
  onClearDate: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(['feature', 'fix', 'backlog'] as Category[]).map((cat) => {
        const active = activeCategories.has(cat);
        return (
          <button
            key={cat}
            onClick={() => onToggleCategory(cat)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all border"
            style={{
              background: active ? CATEGORY_COLORS[cat] + '20' : 'transparent',
              borderColor: active ? CATEGORY_COLORS[cat] + '60' : 'var(--color-border)',
              color: active ? CATEGORY_COLORS[cat] : 'var(--color-text-secondary)',
              opacity: active ? 1 : 0.5,
              fontFamily: 'var(--font-display)',
            }}
          >
            {CATEGORY_LABELS[cat] === 'Fix' ? 'Fixes' : CATEGORY_LABELS[cat] + 's'}
          </button>
        );
      })}

      {selectedDate && (
        <button
          onClick={onClearDate}
          className="px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all"
          style={{
            background: 'var(--color-accent-green)' + '15',
            borderColor: 'var(--color-accent-green)' + '40',
            color: 'var(--color-accent-green)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {formatDateFull(selectedDate)}
          <span className="text-[10px]">&#10005;</span>
        </button>
      )}
    </div>
  );
}

// ─── Category Badge ─────────────────────────────────────────────

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
      style={{
        background: CATEGORY_COLORS[category] + '18',
        color: CATEGORY_COLORS[category],
        fontFamily: 'var(--font-display)',
      }}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

// ─── Session Card ───────────────────────────────────────────────

function SessionCard({
  session,
  items,
  defaultExpanded,
}: {
  session: Session;
  items: ProgressItem[];
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (items.length === 0) return null;

  // Count categories in this session
  const featureCount = items.filter((i) => i.category === 'feature').length;
  const fixCount = items.filter((i) => i.category === 'fix').length;
  const backlogCount = items.filter((i) => i.category === 'backlog').length;

  return (
    <div
      className="rounded-xl border overflow-hidden transition-colors"
      style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)' }}
    >
      {/* Session header — always visible, click to expand */}
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors"
        style={{ background: expanded ? 'var(--color-bg-surface)' : 'transparent' }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Chevron */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-text-secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        <div className="flex-1 min-w-0">
          {/* Session title */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
              style={{
                background: 'var(--color-accent-green)' + '15',
                color: 'var(--color-accent-green)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              S{session.number}
            </span>
            <span
              className="text-sm font-medium leading-snug"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            >
              {session.title || `Session ${session.number}`}
            </span>
          </div>

          {/* Category summary pills */}
          <div className="flex items-center gap-2 mt-1.5">
            {featureCount > 0 && (
              <span className="text-[10px] flex items-center gap-1" style={{ color: CATEGORY_COLORS.feature }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS.feature }} />
                {featureCount} feature{featureCount > 1 ? 's' : ''}
              </span>
            )}
            {fixCount > 0 && (
              <span className="text-[10px] flex items-center gap-1" style={{ color: CATEGORY_COLORS.fix }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS.fix }} />
                {fixCount} fix{fixCount > 1 ? 'es' : ''}
              </span>
            )}
            {backlogCount > 0 && (
              <span className="text-[10px] flex items-center gap-1" style={{ color: CATEGORY_COLORS.backlog }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS.backlog }} />
                {backlogCount} backlog
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded item list */}
      {expanded && (
        <div
          className="border-t px-4 py-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {items.map((item, i) => (
            <ItemRow key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Item Row ───────────────────────────────────────────────────

function ItemRow({ item }: { item: ProgressItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasLongDesc = item.description.length > 140;

  return (
    <div
      className="flex items-start gap-3 py-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)] px-2 -mx-2 cursor-pointer"
      onClick={() => hasLongDesc && setExpanded(!expanded)}
    >
      {/* Category badge */}
      <div className="mt-0.5 shrink-0">
        <CategoryBadge category={item.category} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <span
          className="text-[13px] font-medium"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {item.name}
        </span>
        {item.description && item.description !== item.name && (
          <p
            className="text-xs mt-0.5 leading-relaxed"
            style={{
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-body)',
              display: '-webkit-box',
              WebkitLineClamp: expanded ? 999 : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.description}
          </p>
        )}
        {hasLongDesc && (
          <button
            className="text-[10px] mt-0.5"
            style={{ color: 'var(--color-accent-green)' }}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Day Section ────────────────────────────────────────────────

function DaySection({
  day,
  activeCategories,
  isFirst,
}: {
  day: DayGroup;
  activeCategories: Set<Category>;
  isFirst: boolean;
}) {
  const filteredSessions = day.sessions
    .map((session) => ({
      session,
      items: session.items.filter((item) => activeCategories.has(item.category)),
    }))
    .filter((s) => s.items.length > 0);

  if (filteredSessions.length === 0) return null;

  const totalItems = filteredSessions.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="mb-6">
      {/* Date header */}
      <div className="flex items-center gap-3 mb-3">
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {formatDateFull(day.date)}
        </span>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full tabular-nums"
          style={{
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {totalItems} items &middot; {filteredSessions.length} session{filteredSessions.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Session cards */}
      <div className="flex flex-col gap-2">
        {filteredSessions.map(({ session, items }, idx) => (
          <SessionCard
            key={session.number}
            session={session}
            items={items}
            defaultExpanded={isFirst && idx === 0}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function DevProgressTab() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    new Set(['feature', 'fix', 'backlog'])
  );

  useEffect(() => {
    fetch('/api/dev-progress')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then((json: ProgressData) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const toggleCategory = (cat: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        if (next.size > 1) next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const filteredDays = useMemo(() => {
    if (!data) return [];
    if (selectedDate) return data.days.filter((d) => d.date === selectedDate);
    return data.days;
  }, [data, selectedDate]);

  // ─── Loading state ────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-xl border p-4 animate-pulse"
              style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)' }}
            >
              <div className="h-7 w-12 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
              <div className="h-3 w-20 rounded mt-2" style={{ background: 'var(--color-bg-tertiary)' }} />
            </div>
          ))}
        </div>
        <div
          className="rounded-xl border animate-pulse"
          style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', height: 180 }}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <div
          className="rounded-xl border p-6 text-center"
          style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)' }}
        >
          <p style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
            {error || 'Failed to load progress data'}
          </p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Sessions" value={data.stats.totalSessions} />
        <StatCard label="Features Built" value={data.stats.totalFeatures} color="var(--color-accent-green)" />
        <StatCard label="Bugs Fixed" value={data.stats.totalFixes} color="#d97706" />
        <StatCard label="Backlog Items" value={data.stats.totalBacklog} color="#94a3b8" />
      </div>

      {/* Ticket Panel */}
      <div className="mb-4">
        <TicketPanel />
      </div>

      {/* Chart */}
      <div className="mb-4">
        <StackedBarChart
          days={data.days}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </div>

      {/* Filters */}
      <div className="mb-5">
        <FilterBar
          activeCategories={activeCategories}
          onToggleCategory={toggleCategory}
          selectedDate={selectedDate}
          onClearDate={() => setSelectedDate(null)}
        />
      </div>

      {/* Session list */}
      <div>
        {filteredDays.map((day, idx) => (
          <DaySection
            key={day.date}
            day={day}
            activeCategories={activeCategories}
            isFirst={idx === 0}
          />
        ))}
        {filteredDays.length === 0 && (
          <div
            className="rounded-xl border p-8 text-center"
            style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)' }}
          >
            <p style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
              No items match the current filters.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
