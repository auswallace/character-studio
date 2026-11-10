'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// ─── Settings chip ────────────────────────────────────────
// The pill + dropdown used in the floating panel of the Studio tabs.
// Extracted from the Ads tab so Video and Ads share one implementation.

export function SettingsChip({
  open, onToggle, icon, label, children, dropdownRef, minWidth = 90, title, maxHeight,
}: {
  open: boolean; onToggle: () => void; icon: React.ReactNode; label: string; children: React.ReactNode;
  dropdownRef: React.RefObject<HTMLDivElement | null>; minWidth?: number; title: string; maxHeight?: number;
}) {
  // Opens upward when there is not enough room below (the Studio panels sit at the bottom of the screen),
  // and is always height-capped with its own scrollbar so long option lists stay reachable.
  const [up, setUp] = useState(false);
  const [cap, setCap] = useState(280);
  const toggle = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!open) {
      const r = e.currentTarget.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const goUp = below < 220 && above > below;
      setUp(goUp);
      setCap(Math.max(120, Math.min(maxHeight ?? 320, (goUp ? above : below) - 8)));
    }
    onToggle();
  };
  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <div
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '5px 12px', borderRadius: 10,
          background: open ? '#EFF6FF' : 'var(--color-bg-surface)',
          border: `1px solid ${open ? '#1E40AF' : '#e5e7eb'}`,
          fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap' as const, transition: 'all 0.15s',
          color: open ? '#1E40AF' : '#555',
        }}
      >
        {icon}
        <span style={{ fontWeight: open ? 600 : 500, fontSize: 12 }}>{label}</span>
        <ChevronDown size={11} style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute', ...(up ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }), left: 0,
          background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
          padding: 4, zIndex: 300, minWidth, maxHeight: cap, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}

export function ChipOption<T extends string | number>({ value, selected, onPick, label, hint }: { value: T; selected: boolean; onPick: (v: T) => void; label: string; hint?: string }) {
  return (
    <div
      onClick={() => onPick(value)}
      style={{
        padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        background: selected ? '#EFF6FF' : 'transparent',
        color: selected ? '#1E40AF' : 'var(--color-text-secondary)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span>{label}</span>
        {hint && <span style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{hint}</span>}
      </span>
      {selected && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1E40AF', flexShrink: 0 }} />}
    </div>
  );
}

export function ChipSection({ label }: { label: string }) {
  return <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '6px 8px 2px', borderTop: '1px solid var(--color-border)', marginTop: 4 }}>{label}</div>;
}
