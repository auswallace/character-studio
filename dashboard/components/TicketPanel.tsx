'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────
interface DevTicket {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ─── Constants ─────────────────────────────────────────
const CATEGORIES = ['Dashboard', 'Pipeline', 'X Reposter', 'Twitter', 'Video', 'Content', 'Infrastructure'] as const;
const PRIORITIES = ['High', 'Medium', 'Low'] as const;

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  Dashboard:      { bg: 'rgba(59,130,246,0.1)',  text: '#3b82f6' },
  Pipeline:       { bg: 'rgba(139,92,246,0.1)',  text: '#8b5cf6' },
  'X Reposter':   { bg: 'rgba(22,163,74,0.08)', text: '#16A34A' },
  Twitter:        { bg: 'rgba(6,182,212,0.1)',    text: '#06b6d4' },
  Video:          { bg: 'rgba(236,72,153,0.1)',   text: '#ec4899' },
  Content:        { bg: 'rgba(245,158,11,0.1)',   text: '#f59e0b' },
  Infrastructure: { bg: 'rgba(107,114,128,0.1)',  text: '#6b7280' },
};

// ─── Helpers ───────────────────────────────────────────
function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  return `${diffDay}d ago`;
}

// ─── Component ─────────────────────────────────────────
export default function TicketPanel() {
  const [tickets, setTickets] = useState<DevTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<string>('Dashboard');
  const [newPriority, setNewPriority] = useState<string>('Medium');
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState(true);

  // Desc auto-save debounce refs
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descCacheRef = useRef<Record<string, string>>({});

  // ─── API Calls ─────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch('/api/dev-tickets');
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setTickets(data.tickets ?? []);
    } catch (err) {
      console.error('[TicketPanel] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const addTicket = useCallback(async () => {
    if (!newTitle.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch('/api/dev-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), category: newCategory, priority: newPriority }),
      });
      if (!res.ok) throw new Error('create failed');
      setNewTitle('');
      await fetchTickets();
    } catch (err) {
      console.error('[TicketPanel] add error:', err);
    } finally {
      setAdding(false);
    }
  }, [newTitle, newCategory, newPriority, adding, fetchTickets]);

  const updateTicket = useCallback(async (id: string, fields: Partial<DevTicket>) => {
    try {
      const res = await fetch(`/api/dev-tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error('update failed');
      await fetchTickets();
    } catch (err) {
      console.error('[TicketPanel] update error:', err);
    }
  }, [fetchTickets]);

  const deleteTicket = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/dev-tickets/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      setExpandedId(null);
      await fetchTickets();
    } catch (err) {
      console.error('[TicketPanel] delete error:', err);
    }
  }, [fetchTickets]);

  const toggleDone = useCallback((ticket: DevTicket) => {
    const newStatus = ticket.status === 'Done' ? 'Open' : 'Done';
    updateTicket(ticket.id, { status: newStatus });
  }, [updateTicket]);

  // ─── Effects ───────────────────────────────────────
  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // ─── Description auto-save ─────────────────────────
  const handleDescChange = useCallback((ticketId: string, value: string) => {
    descCacheRef.current[ticketId] = value;
    // Optimistic update in state
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, description: value } : t));
    if (descTimerRef.current) clearTimeout(descTimerRef.current);
    descTimerRef.current = setTimeout(() => {
      updateTicket(ticketId, { description: descCacheRef.current[ticketId] });
    }, 1500);
  }, [updateTicket]);

  // ─── Derived Data ──────────────────────────────────
  const counts = {
    open: tickets.filter(t => t.status === 'Open').length,
    inProgress: tickets.filter(t => t.status === 'In Progress').length,
    done: tickets.filter(t => t.status === 'Done').length,
  };

  const categoryCounts: Record<string, number> = {};
  for (const t of tickets) {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  }

  const filtered = filterCategory
    ? tickets.filter(t => t.category === filterCategory)
    : tickets;

  const groups = {
    inProgress: filtered.filter(t => t.status === 'In Progress'),
    open: filtered.filter(t => t.status === 'Open'),
    done: filtered.filter(t => t.status === 'Done'),
  };

  // ─── Loading Skeleton ──────────────────────────────
  if (loading) {
    return (
      <div>
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-3"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
        >
          Tickets
        </div>
        <div
          className="animate-pulse rounded-xl border"
          style={{
            minHeight: 120,
            background: 'var(--color-bg-primary)',
            borderColor: 'var(--color-border)',
          }}
        />
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────
  return (
    <div>
      {/* Section label */}
      <div
        className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-3"
        style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
      >
        Tickets
      </div>

      {/* Stats row */}
      <div className="flex gap-4 mb-4">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{counts.open}</span> open
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{counts.inProgress}</span> in progress
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{counts.done}</span> done
        </div>
      </div>

      {/* Quick-add bar */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTicket(); }}
          placeholder="Add a ticket — what needs to be done?"
          className="flex-1 rounded-[10px] px-3.5 py-2.5 text-[13px] outline-none transition-colors"
          style={{
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-display)',
          }}
        />
        <select
          value={newCategory}
          onChange={e => setNewCategory(e.target.value)}
          className="rounded-[10px] px-3 py-2.5 text-xs outline-none cursor-pointer transition-colors"
          style={{
            minWidth: 120,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-primary)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={newPriority}
          onChange={e => setNewPriority(e.target.value)}
          className="rounded-[10px] px-3 py-2.5 text-xs outline-none cursor-pointer transition-colors"
          style={{
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-primary)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={addTicket}
          disabled={adding || !newTitle.trim()}
          className="rounded-[10px] px-5 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-all cursor-pointer"
          style={{
            background: 'var(--color-accent-green)',
            color: '#fff',
            border: 'none',
            opacity: adding || !newTitle.trim() ? 0.5 : 1,
            fontFamily: 'var(--font-display)',
          }}
          onMouseEnter={e => { if (!adding && newTitle.trim()) (e.target as HTMLButtonElement).style.background = 'var(--color-accent-green-hover)'; }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'var(--color-accent-green)'; }}
        >
          Add
        </button>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setFilterCategory(null)}
          className="px-3 py-1 rounded-full text-[11px] font-medium border transition-all cursor-pointer"
          style={{
            background: filterCategory === null ? 'var(--color-accent-green-muted)' : 'transparent',
            borderColor: filterCategory === null ? 'rgba(22,163,74,0.3)' : 'var(--color-border)',
            color: filterCategory === null ? 'var(--color-accent-green)' : 'var(--color-text-secondary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          All <span style={{ marginLeft: 4, opacity: 0.6 }}>{tickets.length}</span>
        </button>
        {CATEGORIES.map(cat => {
          const count = categoryCounts[cat] || 0;
          const isActive = filterCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(isActive ? null : cat)}
              className="px-3 py-1 rounded-full text-[11px] font-medium border transition-all cursor-pointer"
              style={{
                background: isActive ? 'var(--color-accent-green-muted)' : 'transparent',
                borderColor: isActive ? 'rgba(22,163,74,0.3)' : 'var(--color-border)',
                color: isActive ? 'var(--color-accent-green)' : 'var(--color-text-secondary)',
                fontFamily: 'var(--font-display)',
              }}
            >
              {cat} <span style={{ marginLeft: 4, opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Status groups */}
      {groups.inProgress.length > 0 && (
        <StatusGroup
          label="In Progress"
          dotColor="#d97706"
          count={groups.inProgress.length}
          tickets={groups.inProgress}
          expandedId={expandedId}
          onToggleExpand={setExpandedId}
          onToggleDone={toggleDone}
          onUpdate={updateTicket}
          onDelete={deleteTicket}
          onDescChange={handleDescChange}
        />
      )}
      {groups.open.length > 0 && (
        <StatusGroup
          label="Open"
          dotColor="var(--color-accent-green)"
          count={groups.open.length}
          tickets={groups.open}
          expandedId={expandedId}
          onToggleExpand={setExpandedId}
          onToggleDone={toggleDone}
          onUpdate={updateTicket}
          onDelete={deleteTicket}
          onDescChange={handleDescChange}
        />
      )}
      {groups.done.length > 0 && (
        <DoneGroup
          count={groups.done.length}
          tickets={groups.done}
          collapsed={doneCollapsed}
          onToggleCollapse={() => setDoneCollapsed(prev => !prev)}
          expandedId={expandedId}
          onToggleExpand={setExpandedId}
          onToggleDone={toggleDone}
          onUpdate={updateTicket}
          onDelete={deleteTicket}
          onDescChange={handleDescChange}
        />
      )}
    </div>
  );
}

// ─── StatusGroup ───────────────────────────────────────
function StatusGroup({
  label,
  dotColor,
  count,
  tickets,
  expandedId,
  onToggleExpand,
  onToggleDone,
  onUpdate,
  onDelete,
  onDescChange,
}: {
  label: string;
  dotColor: string;
  count: number;
  tickets: DevTicket[];
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  onToggleDone: (ticket: DevTicket) => void;
  onUpdate: (id: string, fields: Partial<DevTicket>) => void;
  onDelete: (id: string) => void;
  onDescChange: (id: string, value: string) => void;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
        <span
          className="text-xs font-semibold uppercase tracking-[0.05em]"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
        >
          {label}
        </span>
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
          {count}
        </span>
      </div>
      {tickets.map(ticket => (
        <TicketRow
          key={ticket.id}
          ticket={ticket}
          isExpanded={expandedId === ticket.id}
          onToggleExpand={() => onToggleExpand(expandedId === ticket.id ? null : ticket.id)}
          onToggleDone={() => onToggleDone(ticket)}
          onUpdate={onUpdate}
          onDelete={() => onDelete(ticket.id)}
          onDescChange={onDescChange}
          isDone={false}
        />
      ))}
    </div>
  );
}

// ─── DoneGroup ─────────────────────────────────────────
function DoneGroup({
  count,
  tickets,
  collapsed,
  onToggleCollapse,
  expandedId,
  onToggleExpand,
  onToggleDone,
  onUpdate,
  onDelete,
  onDescChange,
}: {
  count: number;
  tickets: DevTicket[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  onToggleDone: (ticket: DevTicket) => void;
  onUpdate: (id: string, fields: Partial<DevTicket>) => void;
  onDelete: (id: string) => void;
  onDescChange: (id: string, value: string) => void;
}) {
  return (
    <div className="mb-5">
      <div
        className="flex items-center gap-2 mb-2.5 cursor-pointer"
        onClick={onToggleCollapse}
      >
        <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-success)' }} />
        <span
          className="text-xs font-semibold uppercase tracking-[0.05em]"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
        >
          Done
        </span>
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
          {count}
        </span>
        <span
          className="text-[10px] ml-auto transition-transform duration-200"
          style={{
            color: 'var(--color-text-tertiary)',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          }}
        >
          &#9654;
        </span>
      </div>
      {!collapsed && tickets.map(ticket => (
        <TicketRow
          key={ticket.id}
          ticket={ticket}
          isExpanded={expandedId === ticket.id}
          onToggleExpand={() => onToggleExpand(expandedId === ticket.id ? null : ticket.id)}
          onToggleDone={() => onToggleDone(ticket)}
          onUpdate={onUpdate}
          onDelete={() => onDelete(ticket.id)}
          onDescChange={onDescChange}
          isDone={true}
        />
      ))}
    </div>
  );
}

// ─── TicketRow ─────────────────────────────────────────
function TicketRow({
  ticket,
  isExpanded,
  onToggleExpand,
  onToggleDone,
  onUpdate,
  onDelete,
  onDescChange,
  isDone,
}: {
  ticket: DevTicket;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onUpdate: (id: string, fields: Partial<DevTicket>) => void;
  onDelete: () => void;
  onDescChange: (id: string, value: string) => void;
  isDone: boolean;
}) {
  const catColor = CATEGORY_COLORS[ticket.category] || { bg: 'rgba(107,114,128,0.1)', text: '#6b7280' };

  const isInProgress = ticket.status === 'In Progress';

  // Priority display
  let priorityLabel = ticket.priority;
  if (priorityLabel === 'Medium') priorityLabel = 'Med';
  let priorityColor = 'var(--color-text-tertiary)';
  let priorityOpacity = 1;
  if (ticket.priority === 'High') {
    priorityColor = 'var(--color-error)';
  } else if (ticket.priority === 'Low') {
    priorityOpacity = 0.6;
  }

  // Checkbox style
  let checkBorder = 'var(--color-border)';
  let checkBg = 'transparent';
  let checkContent: React.ReactNode = null;

  if (isDone) {
    checkBorder = 'var(--color-success)';
    checkBg = 'var(--color-success)';
    checkContent = <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>&#10003;</span>;
  } else if (isInProgress) {
    checkBorder = '#d97706';
    checkBg = 'rgba(217,119,6,0.1)';
    checkContent = <span style={{ color: '#d97706', fontSize: 8, lineHeight: 1 }}>&#9679;</span>;
  }

  return (
    <div
      className="flex items-start gap-2.5 rounded-[10px] mb-1.5 transition-all"
      style={{
        padding: '10px 14px',
        border: isExpanded ? '1px solid rgba(22,163,74,0.2)' : '1px solid var(--color-border)',
        background: 'var(--color-bg-primary)',
        boxShadow: isExpanded ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
        cursor: 'pointer',
        opacity: isDone ? 0.5 : 1,
      }}
      onClick={onToggleExpand}
    >
      {/* Checkbox */}
      <div
        className="flex-shrink-0 flex items-center justify-center rounded-full transition-all"
        style={{
          width: 18,
          height: 18,
          border: `2px solid ${checkBorder}`,
          background: checkBg,
          marginTop: 1,
          cursor: 'pointer',
        }}
        onClick={e => { e.stopPropagation(); onToggleDone(); }}
        onMouseEnter={e => {
          if (!isDone && !isInProgress) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-accent-green)';
        }}
        onMouseLeave={e => {
          if (!isDone && !isInProgress) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border)';
        }}
      >
        {checkContent}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[13px] font-medium leading-snug"
          style={{
            color: 'var(--color-text-primary)',
            textDecoration: isDone ? 'line-through' : 'none',
            fontFamily: 'var(--font-display)',
          }}
        >
          {ticket.title}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-1.5 mt-1">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.03em] px-2 py-0.5 rounded-md"
            style={{ background: catColor.bg, color: catColor.text }}
          >
            {ticket.category}
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.03em]"
            style={{ color: priorityColor, opacity: priorityOpacity }}
          >
            {priorityLabel}
          </span>
          <span
            className="text-[10px] ml-auto whitespace-nowrap"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {relativeTime(ticket.created_at)}
          </span>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="mt-1.5">
            <textarea
              value={ticket.description || ''}
              onChange={e => onDescChange(ticket.id, e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Add a description..."
              className="w-full resize-none outline-none text-xs leading-relaxed"
              style={{
                minHeight: 60,
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                border: 'none',
                fontFamily: 'var(--font-display)',
                padding: '4px 0',
              }}
              rows={3}
            />
            {/* Actions */}
            <div
              className="flex gap-2 mt-2.5 pt-2.5"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              {ticket.status === 'Open' && (
                <ActionButton
                  label="Mark In Progress"
                  onClick={() => onUpdate(ticket.id, { status: 'In Progress' })}
                />
              )}
              {ticket.status === 'In Progress' && (
                <>
                  <ActionButton
                    label="Mark Open"
                    onClick={() => onUpdate(ticket.id, { status: 'Open' })}
                  />
                  <ActionButton
                    label="Mark Done"
                    onClick={() => onUpdate(ticket.id, { status: 'Done' })}
                  />
                </>
              )}
              {ticket.status === 'Done' && (
                <ActionButton
                  label="Reopen"
                  onClick={() => onUpdate(ticket.id, { status: 'Open' })}
                />
              )}
              <ActionButton label="Delete" onClick={onDelete} isDelete />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ActionButton ──────────────────────────────────────
function ActionButton({
  label,
  onClick,
  isDelete = false,
}: {
  label: string;
  onClick: () => void;
  isDelete?: boolean;
}) {
  return (
    <button
      className="px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer"
      style={{
        borderColor: 'var(--color-border)',
        background: 'transparent',
        color: 'var(--color-text-secondary)',
        fontFamily: 'var(--font-display)',
      }}
      onClick={e => { e.stopPropagation(); onClick(); }}
      onMouseEnter={e => {
        const btn = e.currentTarget as HTMLButtonElement;
        if (isDelete) {
          btn.style.color = 'var(--color-error)';
          btn.style.borderColor = 'rgba(239,68,68,0.3)';
        } else {
          btn.style.background = 'var(--color-bg-tertiary)';
        }
      }}
      onMouseLeave={e => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = 'var(--color-text-secondary)';
        btn.style.borderColor = 'var(--color-border)';
        btn.style.background = 'transparent';
      }}
    >
      {label}
    </button>
  );
}
