'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface TimePickerPopoverProps {
  value: string; // HH:MM or empty
  onChange: (time: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10, ... 55

function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display} ${period}`;
}

function formatMinute(m: number): string {
  return String(m).padStart(2, '0');
}

function formatDisplay(time: string): string {
  if (!time) return '';
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:${String(m).padStart(2, '0')} ${period}`;
}

export default function TimePickerPopover({ value, onChange }: TimePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  // Parse current value
  const selectedHour = value ? parseInt(value.split(':')[0], 10) : null;
  const selectedMinute = value ? parseInt(value.split(':')[1], 10) : null;
  // Snap to nearest 5 for display
  const snappedMinute = selectedMinute !== null ? Math.round(selectedMinute / 5) * 5 : null;

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

  // Scroll selected items into view when opening
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (hourListRef.current) {
        const targetHour = selectedHour ?? 12; // default to 12 PM
        const el = hourListRef.current.querySelector(`[data-hour="${targetHour}"]`);
        el?.scrollIntoView({ block: 'center' });
      }
      if (minuteListRef.current && snappedMinute !== null) {
        const el = minuteListRef.current.querySelector(`[data-minute="${snappedMinute}"]`);
        el?.scrollIntoView({ block: 'center' });
      }
    });
  }, [open, selectedHour, snappedMinute]);

  const handleHourClick = useCallback((h: number) => {
    const m = snappedMinute ?? 0;
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }, [onChange, snappedMinute]);

  const handleMinuteClick = useCallback((m: number) => {
    const h = selectedHour ?? 12;
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }, [onChange, selectedHour]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm outline-none transition-colors duration-200 min-w-[130px]"
        style={{
          background: 'var(--color-bg-surface)',
          borderColor: open ? 'var(--color-border-focus)' : 'var(--color-border)',
          color: value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {value ? formatDisplay(value) : 'Pick time...'}
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
          className="absolute top-full left-0 mt-2 z-50 rounded-xl border shadow-lg overflow-hidden"
          style={{
            background: 'var(--color-bg-primary)',
            borderColor: 'var(--color-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            width: '220px',
          }}
        >
          {/* Header */}
          <div className="px-3 py-2 text-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span className="text-xs font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-secondary)' }}>
              {value ? formatDisplay(value) : 'Select Time'}
            </span>
          </div>

          {/* Two columns: Hour | Minute */}
          <div className="flex" style={{ height: '200px' }}>
            {/* Hour column */}
            <div className="flex-1 flex flex-col" style={{ borderRight: '1px solid var(--color-border)' }}>
              <div className="text-center py-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Hour</span>
              </div>
              <div ref={hourListRef} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {HOURS.map(h => {
                  const isSelected = h === selectedHour;
                  return (
                    <button
                      key={h}
                      type="button"
                      data-hour={h}
                      onClick={() => handleHourClick(h)}
                      className="w-full px-2 py-1.5 text-xs text-center transition-all duration-100 hover:bg-black/5"
                      style={{
                        background: isSelected ? 'var(--color-accent-green-muted)' : 'transparent',
                        color: isSelected ? 'var(--color-accent-green)' : 'var(--color-text-secondary)',
                        fontWeight: isSelected ? 600 : 400,
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      {formatHour(h)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Minute column */}
            <div className="flex-1 flex flex-col">
              <div className="text-center py-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Min</span>
              </div>
              <div ref={minuteListRef} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {MINUTES.map(m => {
                  const isSelected = m === snappedMinute;
                  return (
                    <button
                      key={m}
                      type="button"
                      data-minute={m}
                      onClick={() => handleMinuteClick(m)}
                      className="w-full px-2 py-1.5 text-xs text-center transition-all duration-100 hover:bg-black/5"
                      style={{
                        background: isSelected ? 'var(--color-accent-green-muted)' : 'transparent',
                        color: isSelected ? 'var(--color-accent-green)' : 'var(--color-text-secondary)',
                        fontWeight: isSelected ? 600 : 400,
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      :{formatMinute(m)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
