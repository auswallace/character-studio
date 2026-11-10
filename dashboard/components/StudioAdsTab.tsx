'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { readSSEStream } from '@/lib/sse';
import { useToast } from './Toast';
import LibraryPickerModal from './LibraryPickerModal';
import { SettingsChip as Chip, ChipOption } from './SettingsChip';
import { VIDEO_MODELS } from '@/lib/video-providers/types';
import { ChevronDown, Mic, X, Image, History, Check, AlertTriangle, Download, Wand2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────

interface AdClip {
  index: number;
  section: string;
  seconds: number;
  dialogue: string;
  action: string;
  shot: string;
  videoPrompt: string;
  caption: string;
}

interface AdScript {
  title: string;
  totalSeconds: number;
  clips: AdClip[];
  disclosure: string;
  hashtags: string[];
  complianceNotes: string[];
}

interface ClipState {
  status: 'idle' | 'generating' | 'done' | 'error';
  stage?: string;
  videoUrl?: string;      // raw model output
  voiceUrl?: string;      // ElevenLabs mp3
  syncedUrl?: string;     // after lipsync
  error?: string;
}

type AdFormat = '9:16' | '1:1' | '16:9';
type Tone = 'warm' | 'direct' | 'playful' | 'premium';

interface AdModelDef {
  id: string;
  name: string;
  dotColor: string;
  costLabel: string;
  desc: string;
  durations: number[];
}

// Same card style as the Video tab's model grid, filtered to models that speak dialogue.
const adModels: AdModelDef[] = [
  { id: VIDEO_MODELS.KLING_O3, name: 'Kling O3 Omni', dotColor: '#0D9488', costLabel: '~$0.14/s', desc: 'Native dialogue + lip sync', durations: [3, 5, 8, 10, 15] },
  { id: VIDEO_MODELS.GEMINI_OMNI_FLASH, name: 'Gemini Omni Flash', dotColor: '#2563EB', costLabel: '~$0.10/s', desc: 'Synced audio, cheap', durations: [3, 5, 8, 10] },
  { id: VIDEO_MODELS.SEEDANCE_2_5, name: 'Seedance 2.5', dotColor: '#A855F7', costLabel: 'TBD', desc: 'One shot up to 30s', durations: [5, 10, 15, 20, 30] },
  { id: VIDEO_MODELS.VEO_3_1, name: 'Veo 3.1', dotColor: '#3B82F6', costLabel: '~$0.80', desc: 'Google cinematic audio', durations: [4, 6, 8] },
  { id: VIDEO_MODELS.SEEDANCE_2_0, name: 'Seedance 2.0', dotColor: '#A855F7', costLabel: '~$1.50', desc: 'Cinematic, physics', durations: [5, 10] },
];

const modelCardVideos: Record<string, string> = {
  [VIDEO_MODELS.KLING_O3]: '/model-cards/kling-v3.mp4',
  [VIDEO_MODELS.GEMINI_OMNI_FLASH]: '/model-cards/veo-31.mp4',
  [VIDEO_MODELS.SEEDANCE_2_5]: '/model-cards/seedance-20.mp4',
  [VIDEO_MODELS.VEO_3_1]: '/model-cards/veo-31.mp4',
  [VIDEO_MODELS.SEEDANCE_2_0]: '/model-cards/seedance-20.mp4',
};

const sectionBadge: Record<string, { bg: string; text: string }> = {
  hook: { bg: '#FEF3C7', text: '#92400E' },
  problem: { bg: '#FEE2E2', text: '#991B1B' },
  demo: { bg: '#DBEAFE', text: '#1E40AF' },
  proof: { bg: '#EDE9FE', text: '#5B21B6' },
  cta: { bg: '#D1FAE5', text: '#065F46' },
};

// ─── Component ────────────────────────────────────────────

export default function StudioAdsTab() {
  const { addToast } = useToast();

  // Brief
  const [productName, setProductName] = useState('');
  const [brief, setBrief] = useState('');          // what it is + benefits
  const [cta, setCta] = useState('Link in bio');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState<Tone>('warm');
  const [totalSeconds, setTotalSeconds] = useState<number>(15);

  // Generation settings
  const [selectedModel, setSelectedModel] = useState<string>(VIDEO_MODELS.KLING_O3);
  const [clipSeconds, setClipSeconds] = useState(5);
  const [useFixedVoice, setUseFixedVoice] = useState(false);
  const [formats, setFormats] = useState<AdFormat[]>(['9:16']);
  const [sourceImageUrl, setSourceImageUrl] = useState('');
  useEffect(() => {
    // Create > Make an ad hands a still over through localStorage
    try { const u = localStorage.getItem('ads:pendingStill'); if (u) { setSourceImageUrl(u); localStorage.removeItem('ads:pendingStill'); } } catch { /* ignore */ }
  }, []);

  // UI state
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showLenDropdown, setShowLenDropdown] = useState(false);
  const [showClipDropdown, setShowClipDropdown] = useState(false);
  const [showToneDropdown, setShowToneDropdown] = useState(false);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [showFormatDropdown, setShowFormatDropdown] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gridColumns, setGridColumns] = useState(3);

  const lenRef = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLDivElement | null>(null);
  const toneRef = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef<HTMLDivElement | null>(null);
  const formatRef = useRef<HTMLDivElement | null>(null);

  // Pipeline state
  const [script, setScript] = useState<AdScript | null>(null);
  const [writing, setWriting] = useState(false);
  const [clips, setClips] = useState<Record<number, ClipState>>({});
  const [finishing, setFinishing] = useState(false);
  const [outputs, setOutputs] = useState<{ format: string; url: string; bytes: number }[]>([]);

  const currentModel = adModels.find(m => m.id === selectedModel) || adModels[0];

  const closeAll = () => {
    setShowLenDropdown(false); setShowClipDropdown(false); setShowToneDropdown(false);
    setShowVoiceDropdown(false); setShowFormatDropdown(false);
  };

  // Click outside closes chips + model dropdown (same pattern as Video tab)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (showLenDropdown && lenRef.current && !lenRef.current.contains(t)) setShowLenDropdown(false);
      if (showClipDropdown && clipRef.current && !clipRef.current.contains(t)) setShowClipDropdown(false);
      if (showToneDropdown && toneRef.current && !toneRef.current.contains(t)) setShowToneDropdown(false);
      if (showVoiceDropdown && voiceRef.current && !voiceRef.current.contains(t)) setShowVoiceDropdown(false);
      if (showFormatDropdown && formatRef.current && !formatRef.current.contains(t)) setShowFormatDropdown(false);
      if (modelDropdownOpen && !(e.target as HTMLElement).closest?.('[data-ads-model-dropdown]')) setModelDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLenDropdown, showClipDropdown, showToneDropdown, showVoiceDropdown, showFormatDropdown, modelDropdownOpen]);

  const setClip = useCallback((i: number, patch: Partial<ClipState>) => {
    setClips(prev => ({ ...prev, [i]: { ...(prev[i] || { status: 'idle' }), ...patch } }));
  }, []);

  // ── 1. Script ──
  const canWrite = !writing && !!productName.trim() && !!brief.trim();

  const writeScript = useCallback(async () => {
    if (!canWrite) return;
    setWriting(true);
    setScript(null);
    setClips({});
    setOutputs([]);
    try {
      const res = await fetch('/api/ads/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName, productDescription: brief, audience: audience || undefined, cta, tone, totalSeconds, clipSeconds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setScript(data);
      addToast(`Script ready: ${data.clips.length} clips`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Script failed', 'error');
    } finally {
      setWriting(false);
    }
  }, [canWrite, productName, brief, audience, cta, tone, totalSeconds, clipSeconds, addToast]);

  // Cmd+Enter writes the script
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canWrite) {
        e.preventDefault();
        writeScript();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [canWrite, writeScript]);

  // ── 3. Fixed voice + lipsync ──
  const applyVoice = useCallback(async (clip: AdClip, videoUrl: string) => {
    setClip(clip.index, { status: 'generating', stage: 'Making voice line...' });
    const v = await fetch('/api/ads/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clip.dialogue, label: `clip${clip.index}` }),
    });
    const vd = await v.json();
    if (!v.ok) throw new Error(vd.error || 'voice failed');
    setClip(clip.index, { voiceUrl: vd.url, stage: 'Lip syncing...' });

    const l = await fetch('/api/ads/lipsync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl, audioUrl: vd.url, label: `clip${clip.index}` }),
    });
    const ld = await l.json();
    if (!l.ok) throw new Error(ld.error || 'lipsync failed');
    setClip(clip.index, { status: 'done', syncedUrl: ld.url, stage: 'Synced' });
  }, [setClip]);

  // ── 2. Generate one clip ──
  const generateClip = useCallback(async (clip: AdClip) => {
    if (!sourceImageUrl) { addToast('Pick a spokesperson image first', 'error'); return; }
    setClip(clip.index, { status: 'generating', stage: 'Submitting...', error: undefined, videoUrl: undefined, syncedUrl: undefined });
    try {
      const res = await fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          prompt: clip.videoPrompt,
          sourceImageUrl,
          duration: clip.seconds,
          aspectRatio: '9:16',
          resolution: '1080p',
          generateAudio: true,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      let gotUrl = '';
      let streamError = '';
      await readSSEStream(res, {
        onVideo: (url) => { gotUrl = url; setClip(clip.index, { videoUrl: url, stage: 'Video ready' }); },
        onImage: () => {},
        onProgress: (stage) => setClip(clip.index, { stage }),
        onDone: () => setClip(clip.index, { status: 'done', stage: 'Done' }),
        onError: (message) => { streamError = message; },
      });
      if (streamError) throw new Error(streamError);
      if (!gotUrl) throw new Error('No video returned');
      if (useFixedVoice) await applyVoice(clip, gotUrl);
    } catch (err) {
      setClip(clip.index, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }, [sourceImageUrl, selectedModel, useFixedVoice, applyVoice, setClip, addToast]);

  // ── 4. Finish ──
  const allDone = !!script && script.clips.every(c => clips[c.index]?.status === 'done');
  const finish = async () => {
    if (!script || !allDone) return;
    setFinishing(true);
    setOutputs([]);
    try {
      const res = await fetch('/api/ads/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: script.clips.map(c => ({ url: clips[c.index].syncedUrl || clips[c.index].videoUrl, seconds: c.seconds, caption: c.caption })),
          disclosure: script.disclosure,
          formats,
          label: script.title,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOutputs(data.outputs);
      addToast(`Exported ${data.outputs.length} format(s)`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Finish failed', 'error');
    } finally {
      setFinishing(false);
    }
  };

  const clipCount = Math.max(1, Math.round(totalSeconds / clipSeconds));
  const estCost = (clipCount * clipSeconds * 0.14).toFixed(2);

  // ─── Render ─────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }} className="fade-in">
      {/* Toolbar — matches Video/Copy/Carousel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', flexShrink: 0 }}>
        <button style={{ fontSize: 12, fontWeight: 500, color: '#999', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0', fontFamily: 'inherit' }}>
          <History size={13} />
          {script ? script.title : 'Ads'}
        </button>
        <input type="range" min={1} max={4} value={gridColumns} onChange={(e) => setGridColumns(Number(e.target.value))} className="grid-slider" style={{ width: 120, cursor: 'pointer' }} />
      </div>

      {/* Shared keyframes also live in StudioVideoTab; duplicated here so this tab stands alone */}
      <style>{`
        @keyframes shimmerSlide { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes shimmerText { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
        .shimmer-text { background: linear-gradient(90deg, #333 0%, #333 35%, #999 50%, #333 65%, #333 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: shimmerText 2s ease-in-out infinite; }
      `}</style>

      {/* ========== FULL-WIDTH CLIP GRID AREA ========== */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 280 }}>
        {script ? (
          <>
            {script.complianceNotes.length > 0 && (
              <div style={{ background: 'var(--color-warning-muted)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{script.complianceNotes.join(' · ')}</span>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: 6 }}>
              {script.clips.map(clip => {
                const s = clips[clip.index] || { status: 'idle' as const };
                const preview = s.syncedUrl || s.videoUrl;
                const badge = sectionBadge[clip.section] || { bg: '#F5F5F5', text: '#666' };
                const working = s.status === 'generating';
                return (
                  <div key={clip.index} style={{ borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* Media */}
                    <div className="relative overflow-hidden" style={{ aspectRatio: '9/16', maxHeight: 320, background: 'var(--color-bg-tertiary)' }}>
                      {preview ? (
                        <video src={preview} controls preload="none" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : working ? (
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, #F5F5F5 0%, #FAFAFA 50%, #F5F5F5 100%)', backgroundSize: '200% 100%', animation: 'shimmerSlide 1.8s ease-in-out infinite' }} />
                      ) : sourceImageUrl ? (
                        <img src={sourceImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }} />
                      ) : null}
                      {/* Badges — top left */}
                      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 6px', borderRadius: 4, background: badge.bg, color: badge.text }}>{clip.index} · {clip.section}</span>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.85)', color: '#555' }}>{clip.seconds}s</span>
                        {s.syncedUrl && <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#D1FAE5', color: '#065F46' }}>synced</span>}
                      </div>
                      {working && (
                        <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, fontSize: 11, fontWeight: 600, color: '#333' }} className="shimmer-text">{s.stage || 'Generating'}</div>
                      )}
                    </div>
                    {/* Text */}
                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>&ldquo;{clip.dialogue}&rdquo;</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{clip.action}. {clip.shot}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Caption: {clip.caption}</div>
                      {s.error && <div style={{ fontSize: 11, color: 'var(--color-error)' }}>{s.error}</div>}
                    </div>
                    {/* Action bar */}
                    <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px' }}>
                      <button
                        onClick={() => generateClip(clip)}
                        disabled={working}
                        style={{
                          flex: 1, fontSize: 12, fontWeight: 600, padding: '7px 10px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
                          cursor: working ? 'not-allowed' : 'pointer',
                          background: s.status === 'done' ? 'var(--color-bg-surface)' : '#16A34A',
                          color: s.status === 'done' ? 'var(--color-text-primary)' : '#fff',
                          opacity: working ? 0.6 : 1,
                        }}
                      >
                        {s.status === 'done' ? 'Regenerate' : working ? 'Working...' : `Generate · ${currentModel.name}`}
                      </button>
                      {s.videoUrl && !s.syncedUrl && !working && (
                        <button
                          onClick={() => applyVoice(clip, s.videoUrl!).catch(err => setClip(clip.index, { status: 'error', error: err instanceof Error ? err.message : String(err) }))}
                          style={{ fontSize: 12, fontWeight: 600, padding: '7px 10px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <Mic size={12} /> Sync voice
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Export row */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)' }}>
              {!allDone && (
                <button
                  onClick={() => script.clips.filter(c => clips[c.index]?.status !== 'done' && clips[c.index]?.status !== 'generating').forEach(c => generateClip(c))}
                  disabled={!sourceImageUrl || script.clips.every(c => clips[c.index]?.status === 'generating')}
                  title={`Fires every unfinished clip at once (~$${estCost})`}
                  style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', fontFamily: 'inherit', cursor: sourceImageUrl ? 'pointer' : 'not-allowed', opacity: sourceImageUrl ? 1 : 0.5 }}
                >
                  Generate all remaining
                </button>
              )}
              <Download size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                Stitch {script.clips.length} clips, burn captions + &ldquo;{script.disclosure}&rdquo;, export {formats.join(' / ')}
              </span>
              <button
                onClick={finish}
                disabled={!allDone || finishing || formats.length === 0}
                style={{
                  marginLeft: 'auto', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 12, border: 'none', fontFamily: 'inherit',
                  background: allDone && !finishing && formats.length ? '#16A34A' : '#E5E5E5', color: allDone && !finishing && formats.length ? '#fff' : '#999',
                  cursor: allDone && !finishing && formats.length ? 'pointer' : 'not-allowed',
                }}
              >
                {finishing ? 'Rendering...' : allDone ? 'Export' : `${script.clips.filter(c => clips[c.index]?.status === 'done').length}/${script.clips.length} clips ready`}
              </button>
              {outputs.map(o => (
                <a key={o.format} href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF', background: '#DBEAFE', borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Check size={12} /> {o.format} · {(o.bytes / 1024 / 1024).toFixed(1)} MB
                </a>
              ))}
            </div>
          </>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 13, textAlign: 'center', padding: 40 }}>
            <div>
              <Wand2 size={28} style={{ opacity: 0.25, margin: '0 auto 10px' }} />
              <div style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Spokesperson ad</div>
              <div style={{ marginTop: 4 }}>Name the product, say what it does, write the script. Then generate each clip and export.</div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* FLOATING BOTTOM PANEL (same shell as the Video tab) */}
      {/* ═══════════════════════════════════════════════════ */}
      <div style={{
        position: 'fixed', bottom: 20, left: 240, right: 20,
        maxWidth: 'clamp(700px, 75%, 1400px)', margin: '0 auto',
        background: 'var(--color-bg-primary)',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.04)',
        zIndex: 100,
        display: 'flex', flexDirection: 'column',
        overflow: 'visible',
      }}>
        {/* Model selector trigger + chips */}
        <div data-ads-model-dropdown style={{
          display: 'flex', alignItems: 'center', padding: '10px 16px',
          borderBottom: '1px solid var(--color-border)', position: 'relative',
          borderRadius: '20px 20px 0 0', overflow: 'visible',
        }}>
          <button
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', background: '#F0F0F3',
              border: '1px solid rgba(0,0,0,0.09)', borderRadius: 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: currentModel.dotColor }} />
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>{currentModel.name}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{currentModel.costLabel}</span>
            <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', marginLeft: 2, transition: 'transform 0.2s', transform: modelDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </button>

          <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.08)', flexShrink: 0, marginLeft: 6 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', flex: 1, minWidth: 0, position: 'relative', zIndex: 250, marginLeft: 6 }}>
            {/* Ad length */}
            <Chip
              dropdownRef={lenRef} open={showLenDropdown} onToggle={() => { const o = showLenDropdown; closeAll(); setShowLenDropdown(!o); }}
              title="Ad length" label={`${totalSeconds}s ad`}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
            >
              {[15, 20, 30].map(v => <ChipOption key={v} value={v} selected={totalSeconds === v} onPick={(x) => { setTotalSeconds(x); setShowLenDropdown(false); }} label={`${v}s`} />)}
            </Chip>

            {/* Clip length (per model) */}
            <Chip
              dropdownRef={clipRef} open={showClipDropdown} onToggle={() => { const o = showClipDropdown; closeAll(); setShowClipDropdown(!o); }}
              title="Clip length" label={`${clipSeconds}s × ${clipCount}`}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 7v10M12 7v10M17 7v10"/></svg>}
            >
              {currentModel.durations.map(v => <ChipOption key={v} value={v} selected={clipSeconds === v} onPick={(x) => { setClipSeconds(x); setShowClipDropdown(false); }} label={`${v}s`} />)}
            </Chip>

            {/* Tone */}
            <Chip
              dropdownRef={toneRef} open={showToneDropdown} onToggle={() => { const o = showToneDropdown; closeAll(); setShowToneDropdown(!o); }}
              title="Tone" label={tone}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
            >
              {(['warm', 'direct', 'playful', 'premium'] as Tone[]).map(v => <ChipOption key={v} value={v} selected={tone === v} onPick={(x) => { setTone(x); setShowToneDropdown(false); }} label={v} />)}
            </Chip>

            {/* Voice */}
            <Chip
              dropdownRef={voiceRef} open={showVoiceDropdown} onToggle={() => { const o = showVoiceDropdown; closeAll(); setShowVoiceDropdown(!o); }}
              title="Voice" label={useFixedVoice ? 'Fixed voice' : 'Model voice'} minWidth={150}
              icon={<Mic size={14} />}
            >
              <ChipOption value="model" selected={!useFixedVoice} onPick={() => { setUseFixedVoice(false); setShowVoiceDropdown(false); }} label="Model voice (varies per clip)" />
              <ChipOption value="fixed" selected={useFixedVoice} onPick={() => { setUseFixedVoice(true); setShowVoiceDropdown(false); }} label="Fixed voice + lip sync (ElevenLabs)" />
            </Chip>

            {/* Export formats (multi) */}
            <Chip
              dropdownRef={formatRef} open={showFormatDropdown} onToggle={() => { const o = showFormatDropdown; closeAll(); setShowFormatDropdown(!o); }}
              title="Export" label={formats.length ? formats.join(' ') : 'format'}
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>}
            >
              {(['9:16', '1:1', '16:9'] as AdFormat[]).map(f => (
                <ChipOption key={f} value={f} selected={formats.includes(f)} onPick={(x) => setFormats(prev => prev.includes(x) ? prev.filter(p => p !== x) : [...prev, x])} label={f} />
              ))}
            </Chip>

            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>est. ~${estCost} video</span>
          </div>

          {/* Model dropdown card grid */}
          {modelDropdownOpen && (
            <div data-ads-model-dropdown style={{
              position: 'absolute', top: 52, left: 16, right: 16, zIndex: 200,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)', borderRadius: 14,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.04)',
              padding: 8,
              display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
              animation: 'fadeIn 0.2s ease-out',
            }}>
              {adModels.map(m => {
                const isActive = selectedModel === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      setSelectedModel(m.id);
                      setModelDropdownOpen(false);
                      if (!m.durations.includes(clipSeconds)) setClipSeconds(m.durations[Math.min(1, m.durations.length - 1)]);
                    }}
                    style={{
                      borderRadius: 10,
                      border: `1.5px solid ${isActive ? m.dotColor : 'transparent'}`,
                      cursor: 'pointer', overflow: 'hidden',
                      background: isActive ? `${m.dotColor}08` : 'var(--color-bg-tertiary)',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ height: 56, position: 'relative', overflow: 'hidden', borderRadius: '9px 9px 0 0' }}>
                      <video src={modelCardVideos[m.id]} autoPlay loop muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, fontWeight: 600, color: m.dotColor, background: 'rgba(255,255,255,0.8)', padding: '1px 5px', borderRadius: 4, backdropFilter: 'blur(4px)' }}>{m.costLabel}</span>
                    </div>
                    <div style={{ padding: '8px 10px 9px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.dotColor, flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: -0.2 }}>{m.name}</span>
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)', paddingLeft: 10 }}>{m.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Panel body */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', padding: 14, gap: 14, height: 200, background: '#FAFAFB', borderRadius: '0 0 20px 20px' }}>

          {/* IMAGE COLUMN — spokesperson start frame from the library */}
          <div style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              onClick={() => setPickerOpen(true)}
              style={{
                flex: 1, borderRadius: 10, position: 'relative',
                border: sourceImageUrl ? 'none' : '2px dashed rgba(0,0,0,0.12)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', background: sourceImageUrl ? 'transparent' : '#EDEDF0',
                transition: 'border-color 0.15s', overflow: 'hidden',
                gap: 4, fontSize: 10, color: 'var(--color-text-tertiary)',
              }}
            >
              {sourceImageUrl ? (
                <>
                  <img src={sourceImageUrl} alt="Spokesperson" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div
                    onClick={(e) => { e.stopPropagation(); setSourceImageUrl(''); }}
                    style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  >
                    <X size={10} style={{ color: '#fff' }} />
                  </div>
                </>
              ) : (
                <>
                  <Image size={20} style={{ opacity: 0.35 }} />
                  <span style={{ fontWeight: 500 }}>Spokesperson</span>
                  <span style={{ fontSize: 9 }}>from library</span>
                </>
              )}
            </div>
          </div>

          {/* BRIEF COLUMN */}
          <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Product name"
                style={{ flex: 1.2, minWidth: 0, border: '1px solid rgba(0,0,0,0.10)', borderRadius: 10, padding: '7px 12px', fontFamily: 'inherit', fontSize: 12, background: '#FFFFFF', color: 'var(--color-text-primary)', outline: 'none' }}
              />
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Audience (optional)"
                style={{ flex: 1, minWidth: 0, border: '1px solid rgba(0,0,0,0.10)', borderRadius: 10, padding: '7px 12px', fontFamily: 'inherit', fontSize: 12, background: '#FFFFFF', color: 'var(--color-text-primary)', outline: 'none' }}
              />
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="CTA"
                style={{ flex: 0.8, minWidth: 0, border: '1px solid rgba(0,0,0,0.10)', borderRadius: 10, padding: '7px 12px', fontFamily: 'inherit', fontSize: 12, background: '#FFFFFF', color: 'var(--color-text-primary)', outline: 'none' }}
              />
            </div>
            <div style={{ position: 'relative', flex: 1, display: 'flex', borderRadius: 10, overflow: 'hidden' }}>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value.substring(0, 1500))}
                placeholder={'What it is + 1-3 real benefits. No claims you can\'t back up.\n\nExample: A single-scoop greens mix. Mixes in water in 10 seconds, no blender. 20 servings per bag.'}
                style={{
                  flex: 1, width: '100%', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 10,
                  padding: '10px 12px', paddingBottom: 24, fontFamily: 'inherit', fontSize: 12,
                  lineHeight: 1.5, resize: 'none', background: '#FFFFFF',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.03)',
                  color: 'var(--color-text-primary)', transition: 'border-color 0.15s',
                }}
              />
              <span style={{ position: 'absolute', bottom: 8, right: 12, fontSize: 10, color: '#ccc' }}>{brief.length}/1500</span>
            </div>
          </div>

          {/* WRITE COLUMN */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 170, gap: 0 }}>
            <button
              onClick={writeScript}
              disabled={!canWrite}
              style={{
                width: '100%', padding: '16px 20px', borderRadius: 14,
                background: canWrite ? 'linear-gradient(135deg, #0F172A, #1E293B 40%, #334155)' : '#E5E5E5',
                color: canWrite ? '#fff' : '#999',
                border: 'none', cursor: canWrite ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                position: 'relative', overflow: 'hidden',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: canWrite ? '0 4px 16px rgba(15,23,42,0.3)' : 'none',
              }}
              onMouseEnter={(e) => { if (canWrite) { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 24px rgba(15,23,42,0.4)'; } }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; if (canWrite) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(15,23,42,0.3)'; }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" fill="white"/></svg>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>{writing ? 'Writing...' : script ? 'Rewrite' : 'Write script'}</span>
            </button>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
              <kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontFamily: 'inherit', fontSize: 9, fontWeight: 600 }}>Cmd</kbd>
              {' + '}
              <kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontFamily: 'inherit', fontSize: 9, fontWeight: 600 }}>Enter</kbd>
            </div>
          </div>
        </div>
      </div>

      <LibraryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onDone={(urls) => { if (urls[0]) setSourceImageUrl(urls[0]); setPickerOpen(false); }}
        persona=""
        alreadySelected={new Set()}
      />
    </div>
  );
}
