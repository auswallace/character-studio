'use client';

// Studio > Create: the front door. One screen, four jobs, built on the existing routes.
//   idea   -> /api/create/takes (4 takes) -> /api/generate (SSE)
//   photo  -> optional /api/characters/deidentify (pose only) -> /api/remix (SSE)
//   video  -> /api/create/keyframe -> /api/remix (her in the frame) -> /api/video Kling Motion (SSE)
//   ad     -> hands the chosen still to Studio > Ads
// Model picking is automatic: the persona's active trained character when there is one, Nano Banana otherwise.

import { useState, useEffect, useRef } from 'react';
import ModelSettings, { useManifest, resolveParams } from './ModelSettings';
import IdentityChip, { identityBody, type IdentityMode } from './IdentityChip';
import { useToast } from './Toast';
import LibraryPickerModal from './LibraryPickerModal';
import ImageLightbox, { type GenerationMeta } from './ImageLightbox';
import { readSSEStream } from '@/lib/sse';
import { Sparkles, Image as ImageIcon, Film, Megaphone, Upload, Link as LinkIcon, X, RefreshCw, ChevronRight } from 'lucide-react';

interface Persona { id: string; name: string; activeCharacterId?: string | null }
interface Character { id: string; name: string; status: string }
type Mode = 'idea' | 'photo' | 'video' | 'ad';
interface Result { id: string; url: string; score: number | null; rerolled?: boolean; via: string; mode: Mode; recordId?: string; kind: 'image' | 'video'; prompt?: string }
interface Job { id: string; label: string; startedAt: number; mode: Mode; error?: string }

const ASPECTS = ['9:16', '3:4', '1:1', '16:9'];
const MODES: { id: Mode; label: string; icon: React.ComponentType<{ size?: number }>; hint: string }[] = [
  { id: 'idea', label: 'From an idea', icon: Sparkles, hint: 'Type a rough idea. Get four takes. Pick one.' },
  { id: 'photo', label: 'Copy this photo', icon: ImageIcon, hint: 'Paste a photo. She is placed into it, same pose and framing.' },
  { id: 'video', label: 'Copy this video', icon: Film, hint: 'Paste a clip link. She is put in the first frame, then the motion is copied onto her.' },
  { id: 'ad', label: 'Make an ad', icon: Megaphone, hint: 'Pick a still of her and go to Ads for script, voice and lip sync.' },
];

const btnStyle = (primary = false, disabled = false): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 10, border: primary ? 'none' : '1px solid var(--color-border)', background: disabled ? '#E5E5E5' : primary ? '#111' : 'var(--color-bg-surface)', color: disabled ? '#999' : primary ? '#fff' : 'var(--color-text-primary)', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' });
const taStyle: React.CSSProperties = { width: '100%', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', outline: 'none' };

function SceneBox({ url, onClear, label }: { url: string; onClear: () => void; label: string }) {
  return (
    <div style={{ position: 'relative', width: 150, flexShrink: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" style={{ width: 150, aspectRatio: '3/4', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--color-border)', display: 'block' }} />
      <span style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>{label}</span>
      <button onClick={onClear} style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={12} /></button>
    </div>
  );
}

function DropZone({ onPick, onUpload, onUrl, onDropFile, hint }: { onPick: () => void; onUpload: () => void; onUrl: (u: string) => void; onDropFile: (f: File) => void; hint: string }) {
  const [u, setU] = useState('');
  return (
    <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onDropFile(f); }}
      style={{ flex: 1, minHeight: 150, border: '2px dashed var(--color-border)', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
      <span>{hint}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button style={btnStyle()} onClick={onPick}><ImageIcon size={13} /> From library</button>
        <button style={btnStyle()} onClick={onUpload}><Upload size={13} /> Upload</button>
      </div>
      <div style={{ display: 'flex', gap: 6, width: '100%', maxWidth: 420 }}>
        <input value={u} onChange={e => setU(e.target.value)} placeholder="or paste an image link" style={{ ...taStyle, padding: '7px 10px', fontSize: 12, resize: 'none' }} />
        <button style={btnStyle()} disabled={!/^https?:\/\//.test(u)} onClick={() => { onUrl(u.trim()); setU(''); }}><LinkIcon size={13} /></button>
      </div>
    </div>
  );
}

export default function StudioCreateTab({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const { addToast } = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [mode, setMode] = useState<Mode>('idea');
  const [aspect, setAspect] = useState('9:16');
  // Nano Banana 2 fields from its WaveSpeed manifest (resolution, web/image search). Sent as `params`.
  const [params, setParams] = useState<Record<string, unknown>>({});
  const { fields: modelFields } = useManifest('model:nanobanana2');
  const [count, setCount] = useState(2);
  const [identity, setIdentity] = useState<IdentityMode>('lora');   // where the face comes from when a trained character exists
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [lightbox, setLightbox] = useState(-1);
  const [now, setNow] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!jobs.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jobs.length]);
  const startJob = (label: string, m: Mode) => { const j: Job = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, label, startedAt: Date.now(), mode: m }; setNow(Date.now()); setJobs(prev => [j, ...prev]); return j.id; };
  const endJob = (id: string, error?: string) => setJobs(prev => error ? prev.map(j => j.id === id ? { ...j, error } : j) : prev.filter(j => j.id !== id));

  // idea
  const [note, setNote] = useState('');
  const [takes, setTakes] = useState<string[]>([]);
  const [takeIdx, setTakeIdx] = useState(-1);
  const [loadingTakes, setLoadingTakes] = useState(false);
  // photo + video
  const [sceneUrl, setSceneUrl] = useState('');
  const [sceneMode, setSceneMode] = useState<'as_is' | 'pose'>('as_is');
  const [sceneNote, setSceneNote] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [clipUrl, setClipUrl] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [herStill, setHerStill] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<'scene' | 'ad'>('scene');
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);

  const persona = personas.find(p => p.id === personaId);
  const active = characters.find(c => c.id === persona?.activeCharacterId && c.status === 'ready');
  const via = !active || identity === 'refs' ? 'reference photos' : identity === 'hybrid' ? `Nano Banana 2 + ${active.name} stills` : active.name;
  const identityParams = active ? identityBody(identity) : { useCharacter: false, sceneEngine: 'lora' as const };

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/config'); const d = await r.json();
        const ps: Persona[] = (d.personas || []).map((p: Persona) => ({ id: p.id, name: p.name, activeCharacterId: p.activeCharacterId }));
        setPersonas(ps);
        const def = localStorage.getItem('pipeline:defaultPersona');
        setPersonaId((def && ps.find(p => p.id === def)?.id) || ps[0]?.id || '');
      } catch { /* ignore */ }
    })();
  }, []);
  useEffect(() => {
    if (!personaId) return;
    fetch(`/api/characters?persona_id=${personaId}`).then(r => r.json()).then(d => setCharacters(d.characters || [])).catch(() => {});
  }, [personaId]);

  // ── helpers ──
  const uploadLocal = async (file: File): Promise<string> => {
    const b64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
    return b64;  // remix accepts data URIs and uploads them itself
  };
  const runImageStream = async (res: Response, meta: { via: string; mode: Mode; prompt?: string }) => {
    if (!res.headers.get('Content-Type')?.includes('text/event-stream')) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    let recordId = '';
    await readSSEStream(res, {
      onImage: (url, index, total) => {
        setStage(`Image ${index + 1} of ${total}`);
        setResults(prev => [{ id: `${Date.now()}_${index}`, url, score: null, via: meta.via, mode: meta.mode, recordId, kind: 'image', prompt: meta.prompt }, ...prev]);
      },
      onProgress: (s) => setStage(s),
      onDone: (d) => { recordId = d.recordId; setStage(''); },
      onError: (m) => { throw new Error(m); },
    });
  };

  // ── idea ──
  const getTakes = async () => {
    if (!note.trim()) { addToast('Type a rough idea first', 'error'); return; }
    setLoadingTakes(true); setTakes([]); setTakeIdx(-1);
    try {
      const r = await fetch('/api/create/takes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note, count: 4 }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'failed');
      setTakes(d.takes || []);
    } catch (e) { addToast(e instanceof Error ? e.message : 'failed', 'error'); }
    finally { setLoadingTakes(false); }
  };
  const generateIdea = async (promptNote: string) => {
    if (!persona) return;
    const jid = startJob(promptNote, 'idea');
    setStage('Writing the prompt...');
    try {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: persona.name, promptNote, imageModel: 'nanobanana2', numImages: count, aspectRatio: aspect, params: resolveParams(modelFields, params, ['aspect_ratio']), ...identityParams }) });
      await runImageStream(res, { via, mode: 'idea', prompt: promptNote });
      endJob(jid);
      addToast(`Done via ${via}`, 'success');
    } catch (e) { const m = e instanceof Error ? e.message : 'failed'; endJob(jid, m); addToast(m, 'error'); }
    finally { setStage(''); }
  };

  // ── photo ──
  const generatePhoto = async (scene: string, fromMode: Mode = 'photo') => {
    if (!persona || !scene) return;
    const jid = startJob(sceneNote.trim() || (sceneMode === 'pose' ? 'copy pose' : 'copy photo'), fromMode);
    try {
      let input = scene;
      if (sceneMode === 'pose' && !scene.startsWith('data:')) {
        setStage('Removing the other person (mannequin)...');
        const r = await fetch('/api/characters/deidentify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sceneUrl: scene }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'mannequin failed');
        input = d.url;
      }
      setStage(`Placing her in the scene via ${via}...`);
      const res = await fetch('/api/remix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heroImageUrl: input, remixPrompt: sceneNote.trim() || 'Recreate this image with her as the subject. Keep the pose, framing, outfit and setting.', persona: persona.name, imageModel: 'nanobanana2', numImages: count, enhancePrompt: true, aspectRatio: aspect, params: resolveParams(modelFields, params, ['aspect_ratio']), ...identityParams }) });
      await runImageStream(res, { via, mode: fromMode, prompt: sceneNote.trim() || 'copy photo' });
      endJob(jid);
      addToast(`Done via ${via}`, 'success');
    } catch (e) { const m = e instanceof Error ? e.message : 'failed'; endJob(jid, m); addToast(m, 'error'); }
    finally { setStage(''); }
  };

  // ── video ──
  const grabFrame = async (url: string) => {
    setBusy(true); setStage('Downloading the clip and grabbing the first frame...');
    try {
      const r = await fetch('/api/create/keyframe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: url }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'keyframe failed');
      setFrameUrl(d.frameUrl); setClipUrl(d.videoUrl); setHerStill('');
    } catch (e) { addToast(e instanceof Error ? e.message : 'failed', 'error'); }
    finally { setBusy(false); setStage(''); }
  };
  const animate = async () => {
    if (!herStill || !clipUrl) return;
    setBusy(true); setStage('Copying the motion onto her (Kling Motion)...');
    try {
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'kling_2.6_motion', prompt: sceneNote.trim() || 'natural movement matching the reference video', sourceImageUrl: herStill, referenceVideoUrl: clipUrl, duration: 5, aspectRatio: aspect, generateAudio: false, characterOrientation: 'image', keepOriginalSound: false }) });
      if (!res.headers.get('Content-Type')?.includes('text/event-stream')) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      await readSSEStream(res, {
        onImage: () => {},
        onVideo: (url) => setResults(prev => [{ id: `${Date.now()}_v`, url, score: null, via: 'Kling Motion', mode: 'video', kind: 'video' }, ...prev]),
        onProgress: (s) => setStage(s),
        onDone: () => setStage(''),
        onError: (m) => { throw new Error(m); },
      });
      addToast('Video done', 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'failed', 'error'); }
    finally { setBusy(false); setStage(''); }
  };

  const onFile = async (f: File, forVideo = false) => {
    if (forVideo) {
      if (f.size > 60 * 1024 * 1024) { addToast('Clip over 60 MB', 'error'); return; }
      // upload the clip via the remix bucket path through keyframe route is URL-only; use a data URL round trip
      addToast('Upload a clip link for now (direct .mp4). File upload for video is next.', 'error');
      return;
    }
    setSceneUrl(await uploadLocal(f));
  };

  // ── styles ──
  const card: React.CSSProperties = { background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 14, padding: 16 };
  const pill = (on: boolean): React.CSSProperties => ({ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: '1px solid', borderColor: on ? '#111' : 'var(--color-border)', background: on ? '#111' : 'transparent', color: on ? '#fff' : 'var(--color-text-secondary)' });
  const btn = btnStyle; const ta = taStyle;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* who + what */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {personas.map(p => <span key={p.id} style={pill(p.id === personaId)} onClick={() => setPersonaId(p.id)}>{p.name}</span>)}
        <span style={{ marginLeft: 6, fontSize: 12, padding: '4px 10px', borderRadius: 999, background: active ? '#D1FAE5' : '#F1F5F9', color: active ? '#065F46' : '#64748B', fontWeight: 600 }}>
          {active ? `${active.name} · trained` : 'No trained character yet · using reference photos'}
        </span>
        {active && <IdentityChip value={identity} onChange={setIdentity} modelLabel="Nano Banana 2" />}
        {!active && <button style={{ ...btn(), padding: '4px 10px', fontSize: 12 }} onClick={() => onNavigate?.('studio.character')}>Build one <ChevronRight size={12} /></button>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {ASPECTS.map(a => <span key={a} style={pill(aspect === a)} onClick={() => setAspect(a)}>{a}</span>)}
          <ModelSettings fields={modelFields} values={params} onChange={setParams} hide={['aspect_ratio']} />
          <span style={{ marginLeft: 6 }}>×</span>
          {[1, 2, 4].map(n => <span key={n} style={pill(count === n)} onClick={() => setCount(n)}>{n}</span>)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {MODES.map(m => { const I = m.icon; const on = mode === m.id; return (
          <div key={m.id} onClick={() => setMode(m.id)} style={{ ...card, cursor: 'pointer', padding: '12px 14px', borderColor: on ? '#111' : 'var(--color-border)', background: on ? '#111' : 'var(--color-bg-primary)', color: on ? '#fff' : 'var(--color-text-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}><I size={15} /> {m.label}</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.75 }}>{m.hint}</div>
          </div>
        ); })}
      </div>

      {/* mode body */}
      <div style={card}>
        {mode === 'idea' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Rough idea. e.g. gym mirror selfie, morning  /  coffee shop, rainy day, laptop  /  beach at sunset" style={ta}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') getTakes(); }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btn(true, loadingTakes || busy)} disabled={loadingTakes || busy} onClick={getTakes}><Sparkles size={13} /> {loadingTakes ? 'Thinking...' : 'Give me 4 takes'}</button>
              <button style={btn(false, busy || !note.trim())} disabled={busy || !note.trim()} onClick={() => generateIdea(note)}>Just make it</button>
            </div>
            {takes.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {takes.map((t, i) => (
                  <div key={i} onClick={() => setTakeIdx(i)} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid', borderColor: takeIdx === i ? '#111' : 'var(--color-border)', background: takeIdx === i ? 'rgba(0,0,0,0.04)' : 'var(--color-bg-surface)', fontSize: 12.5, lineHeight: 1.45, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 700, color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>{t}</span>
                    <button style={{ ...btn(true, busy), padding: '5px 10px', fontSize: 12 }} disabled={busy} onClick={e => { e.stopPropagation(); setTakeIdx(i); generateIdea(t); }}>Make</button>
                  </div>
                ))}
                <button style={{ ...btn(), justifySelf: 'start' }} onClick={getTakes} disabled={loadingTakes}><RefreshCw size={13} /> Four more</button>
              </div>
            )}
          </div>
        )}

        {mode === 'photo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              {sceneUrl ? <SceneBox url={sceneUrl} onClear={() => setSceneUrl('')} label="scene" /> : <DropZone hint="Drop the photo to copy" onDropFile={f => onFile(f)} onPick={() => { setPickerFor('scene'); setPickerOpen(true); }} onUpload={() => fileRef.current?.click()} onUrl={setSceneUrl} />}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  Keep
                  <span style={pill(sceneMode === 'as_is')} onClick={() => setSceneMode('as_is')}>everything (their clothes + setting)</span>
                  <span style={pill(sceneMode === 'pose')} onClick={() => setSceneMode('pose')}>pose only (her body, mannequin step)</span>
                </div>
                <textarea value={sceneNote} onChange={e => setSceneNote(e.target.value)} rows={3} placeholder="Optional changes. e.g. make it a red dress  /  night instead of day  /  hold a coffee" style={ta} />
                <button style={{ ...btn(true, busy || !sceneUrl), alignSelf: 'flex-start' }} disabled={busy || !sceneUrl} onClick={() => generatePhoto(sceneUrl)}><Sparkles size={13} /> Put her in it</button>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          </div>
        )}

        {mode === 'video' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="Direct link to a clip (.mp4). Instagram/TikTok page links don't work yet: download the clip, host it, or upload it to the Library." style={{ ...ta, resize: 'none', padding: '9px 12px' }} />
              <button style={btn(true, busy || !/^https?:\/\//.test(videoUrl))} disabled={busy || !/^https?:\/\//.test(videoUrl)} onClick={() => grabFrame(videoUrl.trim())}><Film size={13} /> Grab frame</button>
            </div>
            <input ref={videoFileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f, true); e.target.value = ''; }} />
            {frameUrl && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <SceneBox url={frameUrl} onClear={() => { setFrameUrl(''); setClipUrl(''); setHerStill(''); }} label="1 · frame" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    Keep
                    <span style={pill(sceneMode === 'as_is')} onClick={() => setSceneMode('as_is')}>everything</span>
                    <span style={pill(sceneMode === 'pose')} onClick={() => setSceneMode('pose')}>pose only</span>
                  </div>
                  <textarea value={sceneNote} onChange={e => setSceneNote(e.target.value)} rows={2} placeholder="Optional changes to the still, and a note for the motion" style={ta} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={btn(true, busy)} disabled={busy} onClick={() => generatePhoto(frameUrl, 'video')}>2 · Put her in the frame</button>
                    <button style={btn(true, busy || !herStill)} disabled={busy || !herStill} onClick={animate} title={herStill ? '' : 'Click a result below to use it as her still'}>3 · Copy the motion onto her</button>
                  </div>
                  {herStill && <div style={{ fontSize: 11, color: '#065F46' }}>Still chosen. Step 3 animates it with the clip&apos;s movement (~$0.56 for 5 s).</div>}
                  {!herStill && results.some(r => r.mode === 'video' && r.kind === 'image') && <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Click one of the stills below to choose it for step 3.</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'ad' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div>Pick a still of her, then Ads writes the script, adds her voice, lip-syncs and exports.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btn(true)} onClick={() => { setPickerFor('ad'); setPickerOpen(true); }}><ImageIcon size={13} /> Pick a still</button>
              <button style={btn()} onClick={() => onNavigate?.('studio.ads')}>Open Ads <ChevronRight size={13} /></button>
            </div>
          </div>
        )}
      </div>

      {(busy || stage) && <div className="shimmer-text" style={{ fontSize: 12, color: '#1E40AF' }}>{stage || 'Working...'}</div>}

      {(results.length > 0 || jobs.length > 0) && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>This session</span>
            <span>Everything is also in the Library.</span>
            <button style={{ ...btn(), marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }} onClick={() => setResults([])}>Clear</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            {jobs.map(j => { const secs = Math.max(0, Math.round((now - j.startedAt) / 1000)); return (
              <div key={j.id} style={{ borderRadius: 10, overflow: 'hidden', border: `1px dashed ${j.error ? '#FCA5A5' : '#93C5FD'}`, background: j.error ? '#FEF2F2' : '#EFF6FF' }}>
                <div className={j.error ? '' : 'animate-pulse'} style={{ width: '100%', aspectRatio: '3/4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, textAlign: 'center' }}>
                  {!j.error && <Sparkles size={20} style={{ color: '#2563EB' }} />}
                  <div style={{ fontSize: 12, fontWeight: 600, color: j.error ? '#991B1B' : '#1E40AF' }}>{j.error ? 'Failed' : `${secs}s`}</div>
                  <div style={{ fontSize: 11, color: j.error ? '#991B1B' : '#1E40AF', lineHeight: 1.4 }}>{j.error || (secs < 10 ? 'Writing the prompt...' : secs < 60 ? `Generating via ${via}...` : 'Still generating (cold character load can take minutes)...')}</div>
                  {j.error && <button style={{ ...btn(), padding: '4px 10px', fontSize: 11 }} onClick={() => setJobs(prev => prev.filter(x => x.id !== j.id))}>Dismiss</button>}
                </div>
                <div style={{ padding: '5px 8px', fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.label}>{j.label}</div>
              </div>
            ); })}
            {results.map(r => (
              <div key={r.id} onClick={() => { if (r.kind === 'image' && mode === 'video') { setHerStill(r.url); addToast('Still chosen for step 3', 'success'); } else if (r.kind === 'image') { setLightbox(results.filter(x => x.kind === 'image').findIndex(x => x.id === r.id)); } }}
                style={{ borderRadius: 10, overflow: 'hidden', border: `2px solid ${herStill === r.url ? '#16A34A' : 'var(--color-border)'}`, background: 'var(--color-bg-surface)', cursor: r.kind === 'image' ? (mode === 'video' ? 'pointer' : 'zoom-in') : 'default', position: 'relative' }}>
                {r.kind === 'video' ? <video src={r.url} controls style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block', background: '#000' }} />
                  /* eslint-disable-next-line @next/next/no-img-element */
                  : <img src={r.url} alt="" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'contain', background: 'var(--color-bg-tertiary)', display: 'block' }} />}
                {r.score != null && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: r.score >= 0.6 ? '#D1FAE5' : r.score >= 0.45 ? '#FEF3C7' : '#FEE2E2', color: r.score >= 0.6 ? '#065F46' : r.score >= 0.45 ? '#92400E' : '#991B1B' }}>{r.score.toFixed(2)}</span>}
                <div style={{ padding: '5px 8px', fontSize: 10, color: 'var(--color-text-tertiary)' }}>{r.via}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lightbox >= 0 && (() => {
        const imgs = results.filter(x => x.kind === 'image');
        if (!imgs[lightbox]) return null;
        const metas: GenerationMeta[] = imgs.map(r => ({ personaName: persona?.name, model: r.via, prompt: r.prompt, provider: 'fal', feature: r.mode === 'photo' || r.mode === 'video' ? 'Image Remix' : 'Image Copy' }));
        return <ImageLightbox images={imgs.map(r => ({ url: r.url }))} initialIndex={lightbox} onClose={() => setLightbox(-1)} generationMetas={metas} imageMeta={imgs.map(() => ({}))}
          actions={{ onDownload: (i) => { const r = imgs[i]; if (!r) return; const a = document.createElement('a'); a.href = r.url; a.download = `${(persona?.name || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${Date.now()}_${i + 1}.jpg`; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); },
            onRemix: (i) => { const r = imgs[i]; if (r) { setSceneUrl(r.url); setMode('photo'); setLightbox(-1); addToast('Set as the photo to copy', 'success'); } } }} />;
      })()}
      <LibraryPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} persona={persona?.name || ''} alreadySelected={new Set()}
        onDone={(urls) => { setPickerOpen(false); const u = urls[0]; if (!u) return; if (pickerFor === 'ad') { try { localStorage.setItem('ads:pendingStill', u); } catch { /* ignore */ } onNavigate?.('studio.ads'); } else setSceneUrl(u); }} />
    </div>
  );
}
