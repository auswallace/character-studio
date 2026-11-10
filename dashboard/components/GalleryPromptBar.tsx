'use client';

// Prompt bar docked at the bottom of the Gallery: generate in the same place you browse.
//  - Jobs appear as tiles at the front of the grid (GalleryTab renders them from `jobs`).
//  - Every job waits 3 seconds before the paid call, with Cancel (undo window).
//  - "Several prompts" mode: blank-line-separated prompts become one job each.
//  - Failed jobs keep a Retry button and survive a reload. A job that was running when the page
//    reloaded cannot be re-attached to its stream; it is shown as interrupted (its result, if it
//    finished, is in the grid).
// Uses /api/generate, the same route and prompt logic as Image Copy.

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Layers, X } from 'lucide-react';
import { readSSEStream } from '@/lib/sse';
import IdentityChip, { identityBody, type IdentityMode } from './IdentityChip';

export interface GalleryJob {
  id: string;
  prompt: string;
  persona: string;
  n: number;
  aspect: string;
  status: 'countdown' | 'running' | 'failed' | 'interrupted';
  startedAt: number;
  stage?: string;
  error?: string;
  body: Record<string, unknown>;
}

const UNDO_MS = 3000;
const STORE = 'gallery.jobs';
const MODELS = [
  { id: 'nanobanana2', name: 'Nano Banana 2' },
  { id: 'nanobanana21', name: 'Nano Banana 2.1' },
  { id: 'nanobanana', name: 'Nano Banana Pro' },
  { id: 'seedream50lite', name: 'Seedream 5.0 Lite' },
  { id: 'seedream45', name: 'Seedream 4.5' },
];
const ASPECTS = ['9:16', '3:4', '1:1', '16:9'];

export function loadStoredJobs(): GalleryJob[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]') as GalleryJob[];
    return raw.map(j => (j.status === 'running' || j.status === 'countdown') ? { ...j, status: 'interrupted' as const, stage: undefined } : j);
  } catch { return []; }
}
export function storeJobs(jobs: GalleryJob[]): void {
  // The reference image (base64, large) is not kept: a job retried after a reload runs from its prompt only.
  try { localStorage.setItem(STORE, JSON.stringify(jobs.map(j => j.body.promptImage ? { ...j, body: { ...j.body, promptImage: undefined } } : j))); } catch { /* storage unavailable */ }
}

interface Props {
  personas: { id?: string; name: string; activeCharacterId?: string | null }[];
  jobs: GalleryJob[];
  setJobs: React.Dispatch<React.SetStateAction<GalleryJob[]>>;
  onFinished: () => void;          // a job produced images: reload the grid
  retryRef: React.MutableRefObject<((job: GalleryJob) => void) | null>;   // lets a tile's Retry button start the job again
  hidden?: boolean;
  reference: string | null;                 // image URL picked with "Use as reference" on a card
  onClearReference: () => void;
}

export default function GalleryPromptBar({ personas, jobs, setJobs, onFinished, retryRef, hidden, reference, onClearReference }: Props) {
  const [text, setText] = useState('');
  const [persona, setPersona] = useState('');
  const [model, setModel] = useState('nanobanana2');
  const [aspect, setAspect] = useState('9:16');
  const [count, setCount] = useState(2);
  const [multi, setMulti] = useState(false);
  const [identity, setIdentity] = useState<IdentityMode>('lora');
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(new Set<string>());
  const [refError, setRefError] = useState('');

  const personaName = persona || personas[0]?.name || '';
  const current = personas.find(p => p.name === personaName);
  const hasCharacter = !!current?.activeCharacterId;
  const prompts = (multi ? text.split(/\n\s*\n/) : [text]).map(s => s.trim()).filter(Boolean);

  const patch = (id: string, p: Partial<GalleryJob>) => setJobs(js => js.map(j => j.id === id ? { ...j, ...p } : j));
  const drop = (id: string) => setJobs(js => js.filter(j => j.id !== id));

  async function run(job: GalleryJob) {
    patch(job.id, { status: 'running', stage: 'Starting...', error: undefined, startedAt: Date.now() });
    try {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.body) });
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Request failed (${res.status})`); }
      let failed = '';
      let made = 0;
      await readSSEStream(res, {
        onImage: () => { made++; },
        onProgress: (stage) => patch(job.id, { stage }),
        onDone: (d) => { made = d.imageCount; },
        onError: (m) => { failed = m; },
      });
      if (failed || !made) { patch(job.id, { status: 'failed', error: failed || 'No image came back', stage: undefined }); if (made) onFinished(); return; }
      drop(job.id);
      onFinished();
    } catch (e) {
      patch(job.id, { status: 'failed', error: e instanceof Error ? e.message : 'failed', stage: undefined });
    }
  }

  function queue(job: GalleryJob) {
    cancelled.current.delete(job.id);
    setJobs(js => [{ ...job, status: 'countdown', startedAt: Date.now(), error: undefined }, ...js.filter(j => j.id !== job.id)]);
    setTimeout(() => { if (!cancelled.current.has(job.id)) run(job); }, UNDO_MS);
  }
  // Tiles call this for Retry; Cancel during the undo window marks the id and removes the tile.
  useEffect(() => { retryRef.current = queue; });
  useEffect(() => {
    const onCancel = (e: Event) => { const id = (e as CustomEvent<string>).detail; cancelled.current.add(id); drop(id); };
    window.addEventListener('gallery-job-cancel', onCancel);
    return () => window.removeEventListener('gallery-job-cancel', onCancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drop only uses the stable setJobs
  }, []);

  // /api/generate takes the reference as bare base64 (same as Image Copy), so the picked URL is read once here.
  async function referenceBase64(): Promise<string | null> {
    if (!reference) return null;
    const blob = await (await fetch(reference)).blob();
    return await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1] || null); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
  }

  async function submit() {
    if (!personaName || (!prompts.length && !reference)) return;
    let promptImage: string | null = null;
    if (reference) { try { promptImage = await referenceBase64(); } catch { setRefError('Could not read the reference image'); return; } }
    setRefError('');
    (prompts.length ? prompts : ['']).forEach((p, i) => queue({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`, prompt: p, persona: personaName, n: count, aspect,
      status: 'countdown', startedAt: Date.now(),
      body: { persona: personaName, promptNote: p, imageModel: model, numImages: count, aspectRatio: aspect, ...(promptImage ? { promptImage } : {}), ...(hasCharacter ? identityBody(identity) : { useCharacter: false }) },
    }));
    setText('');
  }

  if (hidden) return null;
  const sel: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontFamily: 'inherit', cursor: 'pointer' };
  const active = jobs.filter(j => j.status === 'running' || j.status === 'countdown').length;
  const can = !!personaName && (prompts.length > 0 || !!reference);

  return (
    <div style={{ position: 'sticky', bottom: 16, zIndex: 40, marginTop: 16 }}>
      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.10)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {reference && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={reference} alt="Reference" style={{ width: 44, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--color-border)' }} />
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>Reference attached.</strong> She is placed into this scene (pose, framing, setting). The prompt is optional and adds changes.
              {refError && <span style={{ color: '#991B1B', display: 'block' }}>{refError}</span>}
            </span>
            <button type="button" onClick={onClearReference} aria-label="Remove reference" title="Remove reference" style={{ display: 'inline-flex', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}><X size={14} /></button>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          rows={focused || multi || text.includes('\n') ? (multi ? 5 : 3) : 1}
          aria-label="Prompt"
          placeholder={multi ? 'One prompt per block. Leave a blank line between prompts.' : 'Describe the image. e.g. coffee shop window seat, rainy morning, reading'}
          style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', resize: 'none', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Persona" value={personaName} onChange={(e) => setPersona(e.target.value)} style={sel}>
            {personas.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} style={sel} title={hasCharacter && identity === 'lora' ? 'Bypassed while the LoRA renders the image' : 'Image model'}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select aria-label="Aspect ratio" value={aspect} onChange={(e) => setAspect(e.target.value)} style={sel}>
            {ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select aria-label="Images per prompt" value={count} onChange={(e) => setCount(Number(e.target.value))} style={sel}>
            {[1, 2, 4].map(n => <option key={n} value={n}>{n} image{n === 1 ? '' : 's'}</option>)}
          </select>
          {hasCharacter && <IdentityChip value={identity} onChange={setIdentity} modelLabel={MODELS.find(m => m.id === model)?.name} />}
          <button type="button" onClick={() => setMulti(!multi)} aria-pressed={multi} title="Several prompts in one go: separate them with a blank line"
            style={{ ...sel, display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: multi ? '#111' : 'var(--color-border)', background: multi ? '#111' : 'var(--color-bg-primary)', color: multi ? '#fff' : 'var(--color-text-secondary)' }}>
            <Layers size={13} /> Several prompts
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {active ? `${active} in progress · ` : ''}{prompts.length > 1 ? `${prompts.length} prompts × ${count}` : ''}
          </span>
          <button type="button" onClick={submit} disabled={!can} title="Starts after a 3-second undo window (Cmd+Enter)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#111', color: '#fff', opacity: can ? 1 : 0.4, cursor: can ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            <Sparkles size={14} /> Generate
          </button>
        </div>
      </div>
    </div>
  );
}
