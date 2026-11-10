'use client';

// Settings chips rendered from a model manifest (lib/models). One component for every endpoint:
// enums become option lists, booleans become toggles, numbers get presets plus a free input.
// The value object it edits is sent as `params` and the server validates it against the same manifest,
// so what you see here is what goes to the provider (and what the lightbox shows afterwards).

import { useEffect, useRef, useState } from 'react';
import { SettingsChip, ChipOption } from './SettingsChip';
import { SlidersHorizontal } from 'lucide-react';

export interface ManifestField {
  name: string; type: string; default?: unknown; min?: number; max?: number; enum?: string[];
  desc: string; required: boolean; exposed: boolean; label: string; group: string; presets?: (number | string)[];
}

/** Fields for an endpoint id, or for an app model id written as `model:<id>` (resolved to the primary provider's endpoint server-side). */
export function useManifest(endpoint: string | null | undefined): { fields: ManifestField[]; loading: boolean; endpoint: string } {
  const [fields, setFields] = useState<ManifestField[]>([]);
  const [resolved, setResolved] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset + loading flag before the fetch, same pattern as the other tabs
    if (!endpoint) { setFields([]); setResolved(''); return; }
    setLoading(true);
    const q = endpoint.startsWith('model:') ? `model=${encodeURIComponent(endpoint.slice(6))}` : `endpoint=${encodeURIComponent(endpoint)}`;
    fetch(`/api/models?${q}`).then(r => r.json()).then(d => { if (alive) { setFields(d.exposed || []); setResolved(d.endpoint || ''); } }).catch(() => { if (alive) setFields([]); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpoint]);
  return { fields, loading, endpoint: resolved };
}

/** Values to send: what the chips show, i.e. the user's picks plus each shown field's manifest default. Hidden fields are left out. */
export function resolveParams(fields: ManifestField[], values: Record<string, unknown>, hide: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (hide.includes(f.name)) continue;
    const v = values[f.name] ?? f.default;
    if (v !== undefined && v !== null && v !== '') out[f.name] = v;
  }
  return out;
}

function fmt(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : Math.abs(v) < 0.001 ? String(v) : String(Number(v.toFixed(4)));
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return v == null || v === '' ? 'auto' : String(v);
}

export default function ModelSettings({ fields, values, onChange, hide = [] }: {
  fields: ManifestField[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  hide?: string[];   // fields handled by a dedicated chip elsewhere
}) {
  const [open, setOpen] = useState<string>('');
  const noRef = useRef<HTMLDivElement | null>(null);   // SettingsChip wants a ref for outside-click; one shared ref is fine here
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  const shown = fields.filter(f => !hide.includes(f.name));
  if (!shown.length) return null;
  return (
    <>
      {shown.map(f => {
        const cur = values[f.name] ?? f.default;
        if (f.type === 'boolean') {
          const on = cur === true || cur === 'true';
          return (
            <span key={f.name} onClick={() => set(f.name, !on)} title={f.desc || f.label}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, border: '1px solid', borderColor: on ? '#16A34A' : 'var(--color-border)', background: on ? 'rgba(22,163,74,0.08)' : 'transparent', color: on ? '#065F46' : 'var(--color-text-tertiary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#16A34A' : '#bbb' }} /> {f.label}
            </span>
          );
        }
        const isNum = f.type === 'number' || f.type === 'integer';
        const options: (string | number)[] = f.enum ? f.enum : (f.presets || []);
        return (
          <SettingsChip key={f.name} dropdownRef={noRef} open={open === f.name} onToggle={() => setOpen(open === f.name ? '' : f.name)} title={f.label} label={`${f.label} ${fmt(cur)}`} icon={<SlidersHorizontal size={14} />}>
            {options.map(v => <ChipOption key={String(v)} value={v} selected={cur === v || String(cur) === String(v)} onPick={(x) => { set(f.name, x); setOpen(''); }} label={fmt(v)} hint={v === f.default ? 'default' : ''} />)}
            {isNum && (
              <div style={{ padding: '6px 8px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: 'var(--color-text-tertiary)' }}>custom</span>
                <input type="number" defaultValue={typeof cur === 'number' ? cur : undefined} min={f.min} max={f.max} step={f.type === 'integer' ? 1 : 0.01}
                  onKeyDown={e => { if (e.key === 'Enter') { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) { set(f.name, f.type === 'integer' ? Math.round(n) : n); setOpen(''); } } }}
                  style={{ width: 80, fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }} />
                <span style={{ color: 'var(--color-text-tertiary)' }}>{f.min != null && f.max != null ? `${f.min}–${f.max}` : ''}</span>
              </div>
            )}
          </SettingsChip>
        );
      })}
    </>
  );
}
