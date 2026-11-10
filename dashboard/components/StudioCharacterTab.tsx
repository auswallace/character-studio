'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from './Toast';
import LibraryPickerModal from './LibraryPickerModal';
import { SettingsChip, ChipOption } from './SettingsChip';
import ScoreBadge from './ScoreBadge';
import ImageLightbox, { type GenerationMeta } from './ImageLightbox';
import ModelSettings, { useManifest } from './ModelSettings';
import { useScores } from '@/lib/use-scores';
import { triggerFor } from '@/lib/characters/trigger';
import { ChevronDown, Image, X, Sparkles, Trash2, Check, RefreshCw, Plus, Wand2, Upload, Eye } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────

interface Persona { id: string; name: string; traits: string; activeCharacterId: string | null }

interface DatasetImage { id: string; url: string; caption: string | null; approved: boolean; view: string | null; score: number | null; issues: string | null }

interface Character {
  id: string; persona_id: string; version: number; name: string; base_model: 'qwen' | 'flux2' | 'flux3klein' | 'zimage'; endpoints?: { text: string; edit: string | null } | null; trigger_word: string;
  lora_url: string | null; status: 'draft' | 'training' | 'ready' | 'failed' | 'retired'; steps: number | null;
  cost_usd: number | null; error_message: string | null; created_at: string; trained_at: string | null;
  dataset_snapshot: unknown[]; learning_rate?: number | null; training_model?: string | null; provider_input?: Record<string, unknown> | null;
}

// Same 4 shots for every version, so v1 and v2 are judged the same way.
const CHECK_SHOTS = [
  'close-up portrait, looking straight at camera, neutral expression, soft window light, plain background',
  'three-quarter portrait, slight smile, golden hour outdoors, shallow depth of field',
  'half-body, white t-shirt, standing in a bright kitchen, natural light',
  'full body walking on a city sidewalk, jeans and jacket, late afternoon',
];

interface TestResult { id: string; name: string; images: string[]; prompt: string; cost_usd: number; sceneUrl?: string; poseUrl?: string; character: string; check?: boolean; providerInput?: Record<string, unknown> | null }

// Trainer endpoints mirror lib/characters/fal.ts TRAINERS (that file is server-only). The Advanced row renders
// each trainer's real fields from lib/models/<trainer>.json via useManifest, and `defaults` are our starting values.
const BASES = [
  { id: 'flux2' as const, label: 'FLUX.2 [dev]', model: 'fal-ai/flux-2-trainer-v2', rate: 0.0064, defaults: { learning_rate: 0.0002 }, note: 'Biggest model. Text and "put her in this photo" (up to 4 references). No resolution control.' },
  { id: 'flux3klein' as const, label: 'FLUX 3 Klein', model: 'blackforestlabs/flux-3/klein/base/trainer', rate: 0.0043, defaults: { learning_rate: 0.0001, resolution: 1024 }, note: 'Newest (Oct 2026). Trains at 1024px, cheaper, edit endpoint takes up to 10 references.' },
  { id: 'zimage' as const, label: 'Z-Image', model: 'fal-ai/z-image-trainer', rate: 0.00226, defaults: { learning_rate: 0.0001, training_type: 'content' }, note: 'Cheapest. Best 2026 likeness reports. Text only on fal (no "put her in this photo").' },
];

// What a good character dataset looks like (from current LoRA guides: 20-30 images minimum, 40-60 best;
// varied angles, expressions, lighting, outfits; one person per image; no text, blur or heavy filters).
const TARGETS = { face: 12, half: 15, full: 13 } as const;   // 40 total
const VIEW_LABEL: Record<string, string> = { face: 'Face close-ups', half: 'Half body (waist up)', full: 'Full body' };
const VIEW_SHORT: Record<string, string> = { face: 'Face', half: 'Half', full: 'Full' };
const ISSUE_LABEL: Record<string, string> = { multiple_people: 'more than one person', text_or_watermark: 'text / watermark', blurry: 'blurry', face_cropped: 'face cut off', face_hidden: 'face hidden', extreme_angle: 'extreme angle', heavy_filter: 'heavy filter' };
const EXAMPLE_PROMPTS = [
  'half-body, white t-shirt, standing in a bright kitchen holding a coffee cup, morning light, soft smile',
  'full body, gym outfit, mirror selfie pose, fluorescent gym light, phone in hand',
  'close-up portrait, neutral expression, soft window light, plain grey background',
  'full body walking down a city sidewalk, jeans and leather jacket, late afternoon sun',
];
function viewOf(d: DatasetImage): 'face' | 'half' | 'full' | '' {
  const v = (d.view || '').split(':')[0];
  return v === 'face' || v === 'half' || v === 'full' ? v : '';
}
// FLUX.2 at lr 2e-4: ~22 steps/image, cap 1500 ($9.60). Klein (BFL doc: 1500-3000 for characters): ~30 steps/image, cap 2500 ($10.75).
function autoSteps(n: number, base: string = 'flux2'): number {
  if (base === 'zimage') return n <= 40 ? 2000 : n <= 60 ? 2500 : 3000;   // community Z-Image character runs: 2000-4000 steps, more for bigger sets
  return base === 'flux3klein' ? Math.min(2500, Math.max(1000, Math.round(n * 30 / 100) * 100)) : Math.min(1500, Math.max(600, Math.round(n * 22 / 100) * 100));
}
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  training: { bg: '#DBEAFE', text: '#1E40AF' }, ready: { bg: '#D1FAE5', text: '#065F46' },
  failed: { bg: '#FEE2E2', text: '#991B1B' }, retired: { bg: '#F5F5F5', text: '#666' }, draft: { bg: '#FEF3C7', text: '#92400E' },
};

// ─── Component ────────────────────────────────────────────

export default function StudioCharacterTab() {
  const { addToast } = useToast();

  // data
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState('');
  const [dataset, setDataset] = useState<DatasetImage[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [trainingLog, setTrainingLog] = useState<Record<string, string>>({});
  const [results, setResults] = useState<TestResult[]>([]);
  const [section, setSectionState] = useState<'dataset' | 'versions' | 'studio'>('dataset');
  // Restore the remembered section after mount (reading localStorage during render breaks hydration).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const v = localStorage.getItem('character:section'); if (v === 'dataset' || v === 'versions' || v === 'studio') setSectionState(v); } catch { /* ignore */ }
  }, []);
  const setSection = (v: 'dataset' | 'versions' | 'studio') => { setSectionState(v); try { localStorage.setItem('character:section', v); } catch { /* ignore */ } };
  const [openVersion, setOpenVersion] = useState<string>('');
  const [versionResults, setVersionResults] = useState<Record<string, { id: string; name: string; prompt: string; check: boolean; sceneUrl: string | null; images: { url: string; score: number | null }[]; created_at: string }[]>>({});
  const loadVersionResults = async (id: string) => {
    try { const r = await fetch(`/api/characters/${id}/results`); const d = await r.json(); setVersionResults(prev => ({ ...prev, [id]: d.results || [] })); } catch { /* ignore */ }
  };
  const scores = useScores('generation', results.map(r => r.id));

  // ui
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const datasetInputRef = useRef<HTMLInputElement | null>(null);
  const [captioning, setCaptioning] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [filling, setFilling] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [sets, setSets] = useState<{ id: string; name: string; count: number }[]>([]);
  const loadSets = useCallback(async (pid: string) => { try { const r = await fetch(`/api/characters/dataset/sets?persona_id=${pid}`); const d = await r.json(); setSets(d.sets || []); } catch { /* ignore */ } }, []);
  const saveSet = async () => {
    const name = window.prompt(`Name this set (${approved} ticked images):`, `Set ${sets.length + 1} (${approved})`);
    if (!name) return;
    const r = await fetch('/api/characters/dataset/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: personaId, name }) });
    const d = await r.json(); if (!r.ok) { addToast(d.error || 'save failed', 'error'); return; }
    addToast(`Saved "${name}" (${d.count} images)`, 'success'); loadSets(personaId);
  };
  const loadSet = async (id: string) => {
    const r = await fetch('/api/characters/dataset/sets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const d = await r.json(); if (!r.ok) { addToast(d.error || 'load failed', 'error'); return; }
    addToast(`Loaded set: ${d.loaded} images ticked`, 'success'); loadDataset(personaId);
  };
  const [sortLow, setSortLow] = useState(false);
  const [labelProgress, setLabelProgress] = useState('');
  const [viewFilter, setViewFilter] = useState<'all' | 'face' | 'half' | 'full' | 'unsorted' | 'flagged' | 'pending'>('all');
  const [lightbox, setLightbox] = useState<number>(-1);
  const [studioLightbox, setStudioLightbox] = useState<number>(-1);
  // Flat list of Studio result images, newest first, for the lightbox + its info panel.
  const [training, setTraining] = useState(false);
  const [base, setBase] = useState<'qwen' | 'flux2' | 'flux3klein' | 'zimage'>('zimage');
  // Trainer fields in the provider's own names; sent as `params` and validated against the trainer manifest server-side.
  const [trainParams, setTrainParams] = useState<Record<string, unknown>>({});
  const [advanced, setAdvanced] = useState(false);
  const baseDef = BASES.find(b => b.id === base) || BASES[0];
  const { fields: trainFields } = useManifest(baseDef.model);
  const [generating, setGenerating] = useState(false);
  // In-flight Studio jobs: shown as placeholder cards until the result lands. Several can run at once.
  const [jobs, setJobs] = useState<{ id: string; prompt: string; scene?: string; startedAt: number; n: number; scale: number; error?: string }[]>([]);
  const [now, setNow] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!jobs.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jobs.length]);

  // test panel
  const [selectedCharId, setSelectedCharId] = useState('');
  const [charDropdownOpen, setCharDropdownOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [sceneUrl, setSceneUrl] = useState('');
  const [scale, setScale] = useState(1.0);
  const [aspect, setAspect] = useState('9:16');
  const [numImages, setNumImages] = useState(1);
  const [showScale, setShowScale] = useState(false);
  const [showAspect, setShowAspect] = useState(false);
  const [showCount, setShowCount] = useState(false);
  const [upscale, setUpscale] = useState(false);
  const [modelParams, setModelParams] = useState<Record<string, Record<string, unknown>>>({});   // per endpoint, provider field names


  const [sceneMode, setSceneMode] = useState<'reference' | 'pose'>('reference');
  const [showScene, setShowScene] = useState(false);
  const sceneModeRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const aspectRef = useRef<HTMLDivElement | null>(null);
  const countRef = useRef<HTMLDivElement | null>(null);
  const sceneInputRef = useRef<HTMLInputElement | null>(null);
  const [scenePickerOpen, setScenePickerOpen] = useState(false);

  const persona = personas.find(p => p.id === personaId);
  const readyChars = characters.filter(c => c.status === 'ready');
  const selectedChar = characters.find(c => c.id === selectedCharId) || readyChars[0];
  const selectedCanEdit = !!selectedChar;   // every base has a scene path now (Z-Image via WaveSpeed img2img)
  // The endpoint this generate will hit: scene -> edit endpoint, else text. Its manifest drives the settings chips.
  const activeEndpoint = selectedChar?.endpoints ? (sceneUrl ? selectedChar.endpoints.edit : selectedChar.endpoints.text) : null;
  const { fields: manifestFields } = useManifest(activeEndpoint);
  const activeParams = activeEndpoint ? (modelParams[activeEndpoint] || {}) : {};
  const setActiveParams = (next: Record<string, unknown>) => { if (activeEndpoint) setModelParams(prev => ({ ...prev, [activeEndpoint]: next })); };
  // Studio default: prompt expansion on when the endpoint offers it and the user has not touched it
  // (the 4-shot check turns it off server-side). Resolved at read time, no effect needed.
  const hasExpansion = manifestFields.some(x => x.name === 'enable_prompt_expansion');
  const activeParamsResolved = hasExpansion && activeParams.enable_prompt_expansion === undefined ? { ...activeParams, enable_prompt_expansion: true } : activeParams;
  // Flat list of Studio result images, newest first, for the lightbox + its info panel.
  const flatResults = results.flatMap(r => r.images.map((u, i) => ({ url: u, r, i })));
  const studioMetas: GenerationMeta[] = flatResults.map(({ r }) => ({ personaName: persona?.name, genName: r.name, model: r.character, prompt: r.providerInput ? `${r.prompt}\n\n[sent to fal]\n${JSON.stringify(r.providerInput, null, 1)}` : r.prompt, provider: 'fal', refImage: r.poseUrl || r.sceneUrl, outputThumbnails: r.images }));
  // Studio history: everything made with the selected version, from the database, so a reload keeps it.
  useEffect(() => {
    if (!selectedChar?.id) return;
    let alive = true;
    fetch(`/api/characters/${selectedChar.id}/results`).then(r => r.json()).then(d => {
      if (!alive) return;
      const rows = (d.results || []) as { id: string; name: string; prompt: string; sceneUrl: string | null; images: { url: string }[]; providerInput?: Record<string, unknown> | null }[];
      setResults(prev => {
        const have = new Set(prev.map(r => r.id));
        const fromDb: TestResult[] = rows.filter(r => !have.has(r.id) && r.images.length).map(r => ({ id: r.id, name: r.name, images: r.images.map(i => i.url), prompt: r.prompt || '', cost_usd: 0, sceneUrl: r.sceneUrl || undefined, character: selectedChar.name, providerInput: r.providerInput || null }));
        return [...prev.filter(r => r.character === selectedChar.name), ...fromDb];
      });
    }).catch(() => {});
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChar?.id]);
  const captioned = dataset.filter(d => d.approved && d.caption).length;
  const approved = dataset.filter(d => d.approved).length;
  const approvedImgs = dataset.filter(d => d.approved);
  const counts = { face: approvedImgs.filter(d => viewOf(d) === 'face').length, half: approvedImgs.filter(d => viewOf(d) === 'half').length, full: approvedImgs.filter(d => viewOf(d) === 'full').length };
  const unlabeled = approvedImgs.filter(d => !viewOf(d)).length;
  const flagged = dataset.filter(d => d.issues).length;
  const visibleUnsorted = dataset.filter(d => viewFilter === 'all' ? true : viewFilter === 'unsorted' ? !viewOf(d) : viewFilter === 'flagged' ? !!d.issues : viewFilter === 'pending' ? !d.approved : viewOf(d) === viewFilter);
  const visible = sortLow ? [...visibleUnsorted].sort((a, b) => (a.score ?? 9) - (b.score ?? 9)) : visibleUnsorted;
  const trainResolved: Record<string, unknown> = { ...baseDef.defaults, steps: autoSteps(captioned || approved, base), ...(advanced ? trainParams : {}) };
  const effectiveSteps = Number(trainResolved.steps) || autoSteps(captioned || approved, base);
  const estTrain = (effectiveSteps * baseDef.rate).toFixed(2);
  const gaps = (Object.keys(TARGETS) as (keyof typeof TARGETS)[]).filter(k => counts[k] < TARGETS[k]).map(k => `${TARGETS[k] - counts[k]} more ${VIEW_LABEL[k].toLowerCase()}`);
  const gapTotal = (Object.keys(TARGETS) as (keyof typeof TARGETS)[]).reduce((a, k) => a + Math.max(0, TARGETS[k] - counts[k]), 0);
  const pending = dataset.filter(d => !d.approved).length;
  const canTrain = !training && captioned >= 10 && captioned === approved;
  const canGenerate = !!selectedChar && (!!prompt.trim() || !!sceneUrl);

  // ── loads ──
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      const list: Persona[] = (d.personas || []).map((p: Record<string, unknown>) => ({ id: p.id as string, name: p.name as string, traits: (p.traits as string) || '', activeCharacterId: (p.activeCharacterId as string) || null }));
      setPersonas(list);
      if (list[0] && !personaId) setPersonaId(list[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDataset = useCallback(async (pid: string) => {
    if (!pid) return;
    const r = await fetch(`/api/characters/dataset?persona_id=${pid}`);
    const d = await r.json();
    setDataset(d.images || []);
  }, []);
  const loadCharacters = useCallback(async (pid: string) => {
    if (!pid) return;
    const r = await fetch(`/api/characters?persona_id=${pid}`);
    const d = await r.json();
    setCharacters(d.characters || []);
  }, []);
  useEffect(() => {
    // async loads; the rule flags the synchronous-looking call shape, the sets happen after fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sets happen after the awaited fetch, same pattern as the other tabs
    void Promise.all([loadDataset(personaId), loadCharacters(personaId), loadSets(personaId)]);
  }, [personaId, loadDataset, loadCharacters, loadSets]);

  // poll training rows every 20s
  useEffect(() => {
    const trainingIds = characters.filter(c => c.status === 'training').map(c => c.id);
    if (!trainingIds.length) return;
    const t = setInterval(async () => {
      for (const id of trainingIds) {
        try {
          const r = await fetch(`/api/characters/${id}`);
          const d = await r.json();
          if (d.fal?.log) setTrainingLog(prev => ({ ...prev, [id]: d.fal.log }));
          if (d.character?.status && d.character.status !== 'training') {
            addToast(d.character.status === 'ready' ? `${d.character.name} is ready` : `${d.character.name} failed`, d.character.status === 'ready' ? 'success' : 'error');
            loadCharacters(personaId);
          }
        } catch { /* keep polling */ }
      }
    }, 20000);
    return () => clearInterval(t);
  }, [characters, personaId, loadCharacters, addToast]);

  // close chips on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (showScale && scaleRef.current && !scaleRef.current.contains(t)) setShowScale(false);
      if (showAspect && aspectRef.current && !aspectRef.current.contains(t)) setShowAspect(false);
      if (showCount && countRef.current && !countRef.current.contains(t)) setShowCount(false);
      if (showScene && sceneModeRef.current && !sceneModeRef.current.contains(t)) setShowScene(false);
      if (charDropdownOpen && !(e.target as HTMLElement).closest?.('[data-char-dropdown]')) setCharDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showScale, showAspect, showCount, showScene, charDropdownOpen]);

  // ── dataset actions ──
  const addFromLibrary = async (urls: string[]) => {
    setPickerOpen(false);
    if (!urls.length) return;
    const r = await fetch('/api/characters/dataset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: personaId, urls }) });
    const d = await r.json();
    if (!r.ok) { addToast(d.error || 'add failed', 'error'); return; }
    addToast(`Added ${d.added} image${d.added === 1 ? '' : 's'} to the dataset`, 'success');
    loadDataset(personaId);
  };
  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.txt'));
    if (!list.some(f => f.type.startsWith('image/'))) { addToast('Drop image files (captions as .txt next to them are optional)', 'error'); return; }
    if (!personaId) { addToast('Pick a persona first', 'error'); return; }
    setUploading(true);
    setUploadProgress(`0 / ${list.filter(f => f.type.startsWith('image/')).length}`);
    try {
      // Captions go with every batch (they are tiny); images in batches of ~40 MB so no single request is huge.
      const txts = list.filter(f => !f.type.startsWith('image/'));
      const imgs = list.filter(f => f.type.startsWith('image/'));
      const batches: File[][] = []; let cur: File[] = [], size = 0;
      for (const f of imgs) { if (cur.length && size + f.size > 40 * 1024 * 1024) { batches.push(cur); cur = []; size = 0; } cur.push(f); size += f.size; }
      if (cur.length) batches.push(cur);
      let added = 0, withCaption = 0, duplicates = 0, done = 0; const skipped: string[] = [];
      for (const b of batches) {
        const fd = new FormData();
        fd.append('persona_id', personaId);
        [...b, ...txts].forEach(f => fd.append('files', f));
        const r = await fetch('/api/characters/dataset/upload', { method: 'POST', body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'upload failed');
        added += d.added || 0; withCaption += d.withCaption || 0; duplicates += d.duplicates || 0; skipped.push(...(d.skipped || []));
        done += b.length; setUploadProgress(`${done} / ${imgs.length}`);
        loadDataset(personaId);
      }
      addToast(`Added ${added} image${added === 1 ? '' : 's'}${withCaption ? ` (${withCaption} with captions)` : ''}${duplicates ? `, ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped` : ''}${skipped.length ? `, ${skipped.length} skipped: ${skipped[0]}` : ''}`, skipped.length ? 'error' : 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'upload failed', 'error'); }
    finally { setUploading(false); }
  };
  // Runs the caption/sort route in batches of 6 so the button can show "12 / 68" and the grid fills as it goes.
  const runLabeler = async (mode: 'caption' | 'view', force: boolean) => {
    const setBusy = mode === 'view' ? setSorting : setCaptioning;
    const total = mode === 'view' ? (force ? approved : unlabeled) : (force ? approved : approved - captioned);
    setBusy(true); setLabelProgress(`0 / ${total}`);
    let done = 0; const failed: string[] = []; let first = true;
    try {
      for (;;) {
        const r = await fetch('/api/characters/dataset/caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: personaId, mode, force: force && first, limit: 6 }) });
        first = false;
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `${mode} failed`);
        done += d.captioned || 0; failed.push(...(d.failed || []));
        setLabelProgress(`${done} / ${total}`);
        loadDataset(personaId);
        if (!d.captioned && !d.failed?.length) break;          // nothing left
        if (d.remaining === 0 || (force && done >= total)) break;
        if (d.failed?.length && !d.captioned) break;              // every image in the batch failed; stop looping
      }
      const verb = mode === 'view' ? 'Sorted' : 'Captioned';
      addToast(`${verb} ${done} image${done === 1 ? '' : 's'}${failed.length ? `, ${failed.length} failed` : ''}`, failed.length ? 'error' : 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : `${mode} failed`, 'error'); }
    finally { setBusy(false); setLabelProgress(''); }
  };
  const fillGaps = async () => {
    const need = gaps.length ? gapTotal : 0;
    if (!need) { addToast('No gaps. Coverage is full.', 'success'); return; }
    const n = Math.min(need, 20);
    if (!window.confirm(`Generate ${n} image${n === 1 ? '' : 's'} to fill the coverage gaps (about $${(n * 0.04).toFixed(2)})? They land as "pending" for you to approve.`)) return;
    setFilling(true);
    try {
      const r = await fetch('/api/characters/dataset/fill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: personaId, max: n }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'fill failed');
      addToast(`${d.added} new image${d.added === 1 ? '' : 's'} via ${d.via} ($${d.cost_usd}). Approve the good ones under Pending.`, d.failed?.length ? 'error' : 'success');
      setViewFilter('pending');
      loadDataset(personaId);
    } catch (e) { addToast(e instanceof Error ? e.message : 'fill failed', 'error'); }
    finally { setFilling(false); }
  };
  const scoreDataset = async () => {
    setScoring(true);
    try {
      const r = await fetch('/api/characters/dataset/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: personaId }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'score failed');
      addToast(`Scored ${d.scored} images against her mean face. Mean ${d.mean}, lowest ${Number(d.min).toFixed(2)}${d.noFace ? `, ${d.noFace} with no face found` : ''}. Sorted lowest first.`, 'success');
      setSortLow(true);
      loadDataset(personaId);
    } catch (e) { addToast(e instanceof Error ? e.message : 'score failed', 'error'); }
    finally { setScoring(false); }
  };
  const captionAll = (force = false) => runLabeler('caption', force);
  const sortViews = () => runLabeler('view', false);
  const patchImage = async (id: string, patch: Partial<DatasetImage>) => {
    setDataset(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
    await fetch('/api/characters/dataset', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
  };
  const removeImage = async (id: string) => {
    setDataset(prev => prev.filter(d => d.id !== id));
    await fetch('/api/characters/dataset', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  };

  // ── train ──
  const importLora = async () => {
    const url = window.prompt('LoRA file URL (upload with: node scripts/upload-to-fal.mjs <file>):');
    if (!url) return;
    const trig = window.prompt('Trigger word used when it was trained:', triggerFor(persona?.name || ''));
    if (trig === null) return;
    const baseIn = window.prompt('Base model: zimage, flux2, or flux3klein', 'zimage');
    if (!baseIn) return;
    try {
      const r = await fetch('/api/characters/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: personaId, lora_url: url.trim(), trigger_word: trig.trim(), base: baseIn.trim(), notes: 'imported' }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'import failed');
      addToast(`Imported as ${d.name}`, 'success'); loadCharacters(personaId);
    } catch (e) { addToast(e instanceof Error ? e.message : 'import failed', 'error'); }
  };
  const train = async () => {
    if (!canTrain) return;
    const summary = Object.entries(trainResolved).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ');
    if (!window.confirm(`Train ${persona?.name} v${(characters[0]?.version || 0) + 1} on ${captioned} images (${baseDef.label}: ${summary}; about $${estTrain}, ~40 minutes)?`)) return;
    setTraining(true);
    try {
      const r = await fetch('/api/characters/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: personaId, base, params: trainResolved }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'train failed');
      addToast(`Training started: ${d.character.name} (${d.images} images, ~$${d.est_cost_usd})`, 'success');
      loadCharacters(personaId);
    } catch (e) { addToast(e instanceof Error ? e.message : 'train failed', 'error'); }
    finally { setTraining(false); }
  };
  const charAction = async (id: string, action: 'activate' | 'retire' | 'delete') => {
    const r = action === 'delete'
      ? await fetch(`/api/characters/${id}`, { method: 'DELETE' })
      : await fetch(`/api/characters/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const d = await r.json();
    if (!r.ok) { addToast(d.error || `${action} failed`, 'error'); return; }
    loadCharacters(personaId);
    // refresh active_character_id
    fetch('/api/config').then(r => r.json()).then(d => setPersonas((d.personas || []).map((p: Record<string, unknown>) => ({ id: p.id as string, name: p.name as string, traits: (p.traits as string) || '', activeCharacterId: (p.activeCharacterId as string) || null })))).catch(() => {});
  };

  // ── test generation ──
  const uploadScene = async (file: File) => {
    const fd = new FormData(); fd.append('file', file); fd.append('type', 'scene');
    const r = await fetch('/api/video/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) { addToast(d.error || 'upload failed', 'error'); return; }
    setSceneUrl(d.url);
  };
  const generate = async () => {
    if (!selectedChar || (!prompt.trim() && !sceneUrl)) return;
    const job = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, prompt: prompt.trim() || (sceneMode === 'pose' ? 'replicate pose (mannequin)' : 'replicate photo'), scene: sceneUrl || undefined, startedAt: Date.now(), n: numImages, scale };
    const body = { prompt, sceneUrl: sceneUrl || undefined, sceneMode: sceneUrl ? sceneMode : undefined, scale, aspect, numImages, upscale, params: { ...activeParamsResolved, num_images: numImages } };
    const ch = selectedChar;
    setNow(Date.now());
    setJobs(prev => [job, ...prev]);
    setGenerating(true);
    try {
      const r = await fetch(`/api/characters/${ch.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'generate failed');
      setResults(prev => [{ id: d.generationId, name: d.name, images: d.images, prompt: d.prompt, cost_usd: d.cost_usd, sceneUrl: job.scene, poseUrl: d.poseUrl || undefined, character: ch.name, providerInput: d.providerInput || null }, ...prev]);
      setJobs(prev => prev.filter(j => j.id !== job.id));
      addToast(`${d.images.length} image${d.images.length === 1 ? '' : 's'} from ${ch.name} (~$${d.cost_usd})`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'generate failed';
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, error: msg } : j));
      addToast(msg, 'error');
    } finally { setGenerating(false); }
  };
  const [checking, setChecking] = useState(false);
  const runCheck = async () => {
    if (!selectedChar || generating || checking) return;
    setChecking(true);
    try {
      for (const shot of CHECK_SHOTS) {
        const r = await fetch(`/api/characters/${selectedChar.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: shot, scale, aspect: '3:4', numImages: 1, tag: 'check', seed: 1000 + CHECK_SHOTS.indexOf(shot) }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'check failed');
        setResults(prev => [{ id: d.generationId, name: d.name, images: d.images, prompt: d.prompt, cost_usd: d.cost_usd, character: selectedChar.name, check: true }, ...prev]);
      }
      addToast('4-shot check done. See it on the Versions card.', 'success');
      loadVersionResults(selectedChar.id); setOpenVersion(selectedChar.id);
    } catch (e) { addToast(e instanceof Error ? e.message : 'check failed', 'error'); }
    finally { setChecking(false); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canGenerate) { e.preventDefault(); generate(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGenerate, prompt, sceneUrl, sceneMode, scale, aspect, numImages, selectedChar]);

  // ── styles ──
  const card: React.CSSProperties = { background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14 };
  const h: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-tertiary)' };
  const smallBtn = (primary = false, disabled = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 10, fontFamily: 'inherit',
    border: primary ? 'none' : '1px solid var(--color-border)', background: primary ? '#16A34A' : 'var(--color-bg-primary)', color: primary ? '#fff' : 'var(--color-text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  });
  const pill = (active: boolean): React.CSSProperties => ({ fontSize: 12, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', border: '1px solid var(--color-border)', background: active ? 'var(--color-bg-active)' : 'var(--color-bg-primary)', color: active ? 'var(--color-accent-blue-text)' : 'var(--color-text-secondary)' });

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }} className="fade-in">
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {personas.map(p => <span key={p.id} style={pill(p.id === personaId)} onClick={() => setPersonaId(p.id)}>{p.name}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 3 }}>
          {([['dataset', `Dataset · ${approved}`], ['versions', `Versions · ${characters.length}`], ['studio', 'Studio']] as const).map(([k, label]) => (
            <span key={k} onClick={() => setSection(k)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: section === k ? 'var(--color-bg-primary)' : 'transparent', color: section === k ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', boxShadow: section === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{label}</span>
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {captioned} / {approved} captioned · {readyChars.length} trained
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: section === 'studio' ? 280 : 24, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* 1. Dataset (drop images anywhere on this card) */}
        {section === 'dataset' && <div
          style={{ ...card, outline: dragOver ? '2px dashed #16A34A' : 'none', outlineOffset: -2, background: dragOver ? 'var(--color-accent-green-muted)' : card.background, transition: 'background .15s' }}
          onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
          onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOver(false); }}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={h}>1 · Teach it who she is</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Pick about 40 of her best images. The character learns from these, so only her, only good ones.</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button style={smallBtn()} onClick={() => setPickerOpen(true)}><Plus size={13} /> From library</button>
              <button style={smallBtn(false, uploading)} disabled={uploading} onClick={() => datasetInputRef.current?.click()}><Upload size={13} /> {uploading ? `Uploading ${uploadProgress}` : 'Upload files'}</button>
              <input ref={datasetInputRef} type="file" accept="image/*,.txt" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ''; }} />
              <button style={smallBtn(false, captioning || approved === 0)} disabled={captioning || approved === 0} onClick={() => captionAll(false)}><Wand2 size={13} /> {captioning ? `Captioning ${labelProgress}` : `Caption ${approved - captioned || ''}`.trim()}</button>
              {captioned > 0 && <button style={smallBtn(false, captioning)} disabled={captioning} onClick={() => captionAll(true)} title="Rewrite every caption"><RefreshCw size={13} /></button>}
              {unlabeled > 0 && <button style={smallBtn(false, sorting)} disabled={sorting} onClick={sortViews} title="Label face / half / full without touching captions"><Eye size={13} /> {sorting ? `Sorting ${labelProgress}` : `Sort ${unlabeled}`}</button>}
              <button style={smallBtn(false, scoring || approved < 5)} disabled={scoring || approved < 5} onClick={scoreDataset} title="Score every image against the set's own mean face. Low = pulling the character away from herself. Needs the scorer running."><Check size={13} /> {scoring ? 'Scoring...' : 'Score set'}</button>
            </div>
          </div>
          {/* Guide + coverage meter */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10, marginBottom: 12 }}>
            <div style={{ borderRadius: 10, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', padding: '10px 12px', fontSize: 12, lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>What to pick</div>
              <div><b>Mix the framing:</b> about 12 face close-ups, 15 waist-up, 13 full body. Same person, same build in every one.</div>
              <div><b>Vary everything else:</b> different outfits, backgrounds, lighting, angles (front, three-quarter, profile), expressions. If every image is a mirror selfie, she will only know how to do mirror selfies.</div>
              <div><b>Skip:</b> anything with a second person, text or watermarks, blur, heavy filters, or her face cut off or hidden. One bad image hurts more than ten good ones help.</div>
              <div style={{ marginTop: 4, color: 'var(--color-text-tertiary)' }}>Caption writes the training text for you and labels each image. You only need to pick and remove.</div>
            </div>
            <div style={{ borderRadius: 10, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', padding: '10px 12px', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Coverage · {approved} / 40 {approved >= 40 ? <span style={{ color: '#065F46' }}>· enough</span> : ''}</div>
              {(Object.keys(TARGETS) as (keyof typeof TARGETS)[]).map(k => {
                const n = counts[k], t = TARGETS[k], pct = Math.min(100, Math.round(n / t * 100));
                return (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-secondary)' }}><span>{VIEW_LABEL[k]}</span><span>{n} / {t}</span></div>
                    <div style={{ height: 6, borderRadius: 3, background: '#EDEDF0', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#16A34A' : '#60A5FA', transition: 'width .3s' }} /></div>
                  </div>
                );
              })}
              {unlabeled > 0 && <div style={{ color: 'var(--color-text-tertiary)' }}>{unlabeled} not labeled yet. Run Caption to sort them.</div>}
              {flagged > 0 && <div style={{ color: '#92400E' }}>{flagged} flagged. Check the red tags and remove or keep.</div>}
              {gaps.length > 0 && unlabeled === 0 && approved > 0 && <div style={{ color: 'var(--color-text-tertiary)' }}>Need {gaps.join(', ')}.</div>}
              {gapTotal > 0 && (
                <button style={{ ...smallBtn(true, filling), marginTop: 6 }} disabled={filling} onClick={fillGaps} title="Generates one image per missing slot (fixed angles, light and settings) and adds them as pending for you to approve">
                  <Sparkles size={12} /> {filling ? 'Generating...' : `Fill gaps (${Math.min(gapTotal, 20)})`}
                </button>
              )}
            </div>
          </div>
          {dataset.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {([['all', 'All', dataset.length], ['face', 'Face', counts.face], ['half', 'Waist up', counts.half], ['full', 'Full body', counts.full], ['unsorted', 'Unsorted', unlabeled], ['flagged', 'Flagged', flagged], ['pending', 'Pending', pending]] as const).map(([k, label, n]) => (
                ((k === 'flagged' || k === 'pending') && n === 0) ? null : <span key={k} style={pill(viewFilter === k)} onClick={() => setViewFilter(k)}>{label} · {n}</span>
              ))}
              <span style={pill(sortLow)} onClick={() => setSortLow(!sortLow)} title="Lowest face score first">{sortLow ? 'Lowest score first' : 'Newest first'}</span>
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>Sets</span>
              <select value="" onChange={e => { if (e.target.value) loadSet(e.target.value); }} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}>
                <option value="">Load a saved set…</option>
                {sets.map(st => <option key={st.id} value={st.id}>{st.name} · {st.count}</option>)}
              </select>
              <span style={pill(false)} onClick={saveSet} title="Save the current ticked selection under a name">Save set as…</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>Click an image to view it large. Change the label under it if the guess is wrong.</span>
            </div>
          )}
          {dataset.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '22px 0', textAlign: 'center', border: '2px dashed var(--color-border)', borderRadius: 10 }}>Drag photos here (with their .txt captions if you have them), or use From library / Upload files.</div>
          ) : visible.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '18px 0', textAlign: 'center' }}>Nothing in this group.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {visible.map((d, vi) => (
                <div key={d.id} style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${d.approved ? 'var(--color-border)' : '#FCA5A5'}`, background: 'var(--color-bg-surface)', opacity: d.approved ? 1 : 0.6 }}>
                  <div style={{ position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.url} alt="" onClick={() => setLightbox(vi)} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'contain', background: 'var(--color-bg-tertiary)', display: 'block', cursor: 'zoom-in' }} />
                    <div style={{ position: 'absolute', top: 5, right: 5, display: 'flex', gap: 4 }}>
                      <button title={d.approved ? 'Exclude from training' : 'Include'} onClick={() => patchImage(d.id, { approved: !d.approved })} style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: d.approved ? 'rgba(22,163,74,0.85)' : 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} /></button>
                      <button title="Remove" onClick={() => removeImage(d.id)} style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'rgba(220,53,69,0.7)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={12} /></button>
                    </div>
                    <div style={{ position: 'absolute', bottom: 5, left: 5, display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: '90%' }}>
                      {d.issues && d.issues.split(',').filter(Boolean).map(i => <span key={i} style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 5, background: '#FEE2E2', color: '#991B1B' }}>{ISSUE_LABEL[i] || i}</span>)}
                      {d.score != null && <span title="Similarity to the set's mean face. Under 0.45 is probably not her; 0.45-0.60 check it." style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: Number(d.score) >= 0.6 ? '#D1FAE5' : Number(d.score) >= 0.45 ? '#FEF3C7' : '#FEE2E2', color: Number(d.score) >= 0.6 ? '#065F46' : Number(d.score) >= 0.45 ? '#92400E' : '#991B1B' }}>{Number(d.score).toFixed(2)}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, padding: '5px 6px 0', alignItems: 'center' }}>
                    {(['face', 'half', 'full'] as const).map(v => (
                      <span key={v} onClick={() => patchImage(d.id, { view: viewOf(d) === v ? '' : `${v}${d.view?.includes(':') ? ':' + d.view.split(':')[1] : ''}` })}
                        style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, cursor: 'pointer', border: '1px solid', borderColor: viewOf(d) === v ? '#111' : 'var(--color-border)', background: viewOf(d) === v ? '#111' : 'transparent', color: viewOf(d) === v ? '#fff' : 'var(--color-text-tertiary)' }} title={VIEW_LABEL[v]}>{VIEW_SHORT[v]}</span>
                    ))}
                  </div>
                  <textarea
                    value={d.caption || ''}
                    placeholder="no caption yet"
                    onChange={e => setDataset(prev => prev.map(x => x.id === d.id ? { ...x, caption: e.target.value } : x))}
                    onBlur={e => patchImage(d.id, { caption: e.target.value })}
                    style={{ width: '100%', border: 'none', borderTop: '1px solid var(--color-border)', padding: '6px 8px', fontSize: 10.5, lineHeight: 1.35, resize: 'none', height: 64, fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text-secondary)', outline: 'none' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>}
        {lightbox >= 0 && visible[lightbox] && (() => {
          const d = visible[lightbox];
          const go = (n: number) => setLightbox(Math.max(0, Math.min(visible.length - 1, lightbox + n)));
          return (
            <div onClick={() => setLightbox(-1)} onKeyDown={e => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'Escape') setLightbox(-1); }} tabIndex={0} ref={el => el?.focus()}
              style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}>
              <button onClick={e => { e.stopPropagation(); go(-1); }} disabled={lightbox === 0} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 20 }}>‹</button>
              <button onClick={e => { e.stopPropagation(); go(1); }} disabled={lightbox === visible.length - 1} style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 20 }}>›</button>
              <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: '92vw' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.url} alt="" style={{ maxHeight: '78vh', maxWidth: '92vw', objectFit: 'contain', borderRadius: 10 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{lightbox + 1} / {visible.length}</span>
                  {(['face', 'half', 'full'] as const).map(v => (
                    <span key={v} onClick={() => patchImage(d.id, { view: `${v}${d.view?.includes(':') ? ':' + d.view.split(':')[1] : ''}` })}
                      style={{ fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 8, cursor: 'pointer', background: viewOf(d) === v ? '#fff' : 'rgba(255,255,255,0.15)', color: viewOf(d) === v ? '#111' : '#fff' }}>{VIEW_LABEL[v]}</span>
                  ))}
                  <span onClick={() => patchImage(d.id, { approved: !d.approved })} style={{ fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 8, cursor: 'pointer', background: d.approved ? 'rgba(22,163,74,0.85)' : 'rgba(255,255,255,0.15)', color: '#fff' }}>{d.approved ? 'In training set' : 'Excluded'}</span>
                  <span onClick={() => { removeImage(d.id); if (lightbox >= visible.length - 1) setLightbox(lightbox - 1); }} style={{ fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 8, cursor: 'pointer', background: 'rgba(220,53,69,0.8)', color: '#fff' }}>Remove</span>
                </div>
                {d.caption && <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, maxWidth: 640, textAlign: 'center', lineHeight: 1.4 }}>{d.caption}</div>}
              </div>
            </div>
          );
        })()}

        {/* 2. Train + versions */}
        {section === 'versions' && <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={h}>2 · Build the character</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{baseDef.label} · about {base === 'zimage' ? 25 : 40} minutes and ${estTrain}. Comes back as a version you can test and use.</span>
            <button style={smallBtn()} onClick={importLora} title="Register a LoRA trained elsewhere (ai-toolkit, RunPod) as a version">Import LoRA</button>
            <span style={pill(advanced)} onClick={() => { if (!advanced) setTrainParams({ ...baseDef.defaults, steps: autoSteps(captioned || approved, base) }); setAdvanced(!advanced); }}>{advanced ? 'Advanced on' : 'Advanced'}</span>
            <button style={{ ...smallBtn(true, !canTrain), marginLeft: 'auto' }} disabled={!canTrain} onClick={train} title={canTrain ? '' : captioned < 10 ? 'Add at least 10 images and run Caption' : 'Run Caption on the new images first'}>
              <Sparkles size={13} /> {training ? 'Starting...' : `Build ${persona ? persona.name.split(' ')[0] : ''} v${(characters[0]?.version || 0) + 1}`}
            </button>
          </div>
          {!canTrain && !training && (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
              {captioned < 10 ? `Needs at least 10 captioned images (have ${captioned}). 40 is the goal.` : captioned < approved ? `${approved - captioned} images still need captions. Click Caption above.` : ''}
            </div>
          )}
          {advanced && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontSize: 12 }}>
              <span style={{ color: 'var(--color-text-tertiary)' }}>Model</span>
              {BASES.map(b => <span key={b.id} style={pill(base === b.id)} onClick={() => { setBase(b.id); setTrainParams({ ...b.defaults, steps: autoSteps(captioned || approved, b.id) }); }} title={b.note}>{b.label}</span>)}
              <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 6 }} title="Every chip is a real field of this trainer (from its fal schema). The exact JSON sent is kept on the version.">{baseDef.model}</span>
              <ModelSettings fields={trainFields} values={trainParams} onChange={setTrainParams} />
              <span style={{ color: 'var(--color-text-tertiary)' }}>auto = {autoSteps(captioned || approved, base)} steps for {captioned || approved} images</span>
              <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{baseDef.note}</span>
            </div>
          )}
          {characters.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No versions yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {characters.map(c => {
                const col = STATUS_COLOR[c.status] || STATUS_COLOR.draft;
                const isActive = persona?.activeCharacterId === c.id;
                return (
                  <div key={c.id} style={{ borderRadius: 10, border: `1px solid ${isActive ? '#16A34A' : 'var(--color-border)'}`, background: 'var(--color-bg-surface)', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer' }} onClick={() => { const o = openVersion === c.id ? '' : c.id; setOpenVersion(o); if (o) loadVersionResults(c.id); }}>
                    <ChevronDown size={13} style={{ color: 'var(--color-text-tertiary)', transform: openVersion === c.id ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    {isActive && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: '#D1FAE5', color: '#065F46' }}>ACTIVE</span>}
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: col.bg, color: col.text, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.status}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }} title={c.provider_input ? `Sent to ${c.training_model}:\n${JSON.stringify(c.provider_input, null, 2)}` : c.training_model || ''}>{BASES.find(b => b.id === c.base_model)?.label} · {c.steps} steps{c.learning_rate ? ` · lr ${c.learning_rate}` : ''} · {(c.dataset_snapshot as unknown[])?.length || 0} images · ${c.cost_usd ?? '?'} · trigger <code>{c.trigger_word}</code></span>
                    {c.status === 'training' && (() => {
                      const mins = (Date.now() - new Date(c.created_at).getTime()) / 60000;
                      const estMin = Math.max(8, Math.round((c.steps || 1000) * 1.1 / 60) + 4);   // ~1.1 s/step + queue/upload
                      const pct = Math.min(95, Math.round(mins / estMin * 100));
                      return (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1E40AF', minWidth: 220 }}>
                          <span style={{ flex: 1, height: 6, borderRadius: 3, background: '#DBEAFE', overflow: 'hidden' }}><span style={{ display: 'block', width: `${pct}%`, height: '100%', background: '#2563EB', transition: 'width 1s' }} /></span>
                          <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{Math.round(mins)} / ~{estMin} min</span>
                          {trainingLog[c.id] && <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={trainingLog[c.id]}>{trainingLog[c.id]}</span>}
                        </span>
                      );
                    })()}
                    {c.status === 'failed' && c.error_message && <span style={{ color: '#991B1B' }}>{c.error_message.slice(0, 120)}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      {c.status === 'ready' && !isActive && <button style={smallBtn()} onClick={() => charAction(c.id, 'activate')}>Make active</button>}
                      {c.status === 'ready' && <button style={smallBtn()} onClick={() => { setSelectedCharId(c.id); setSection('studio'); }}>Test</button>}
                      {c.status === 'ready' && <button style={smallBtn(true, checking)} disabled={checking} onClick={() => { setSelectedCharId(c.id); setOpenVersion(c.id); setTimeout(runCheck, 0); }}>{checking ? 'Checking...' : '4-shot check'}</button>}
                      {c.status !== 'training' && c.status !== 'retired' && <button style={smallBtn()} onClick={() => charAction(c.id, 'retire')}>Retire</button>}
                      {c.status !== 'training' && <button style={{ ...smallBtn(), color: '#991B1B' }} onClick={() => { if (window.confirm(`Delete ${c.name}?`)) charAction(c.id, 'delete'); }}><Trash2 size={12} /></button>}
                    </div>
                  </div>
                  {openVersion === c.id && (() => {
                    const rs = versionResults[c.id];
                    const checks = (rs || []).filter(r => r.check);
                    const others = (rs || []).filter(r => !r.check);
                    const scored = checks.flatMap(r => r.images).map(i => i.score).filter((x): x is number => x != null);
                    const mean = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
                    const Tile = ({ url, score, label }: { url: string; score: number | null; label: string }) => (
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', position: 'relative' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'contain', background: 'var(--color-bg-tertiary)', display: 'block' }} />
                        {score != null && <span style={{ position: 'absolute', top: 5, right: 5, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: score >= 0.6 ? '#D1FAE5' : score >= 0.45 ? '#FEF3C7' : '#FEE2E2', color: score >= 0.6 ? '#065F46' : score >= 0.45 ? '#92400E' : '#991B1B' }}>{score.toFixed(2)}</span>}
                        <div style={{ padding: '4px 7px', fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>{label}</div>
                      </div>
                    );
                    return (
                      <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {!rs ? <span style={{ color: 'var(--color-text-tertiary)' }}>Loading...</span> : (
                          <>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ fontWeight: 600 }}>4-shot check</span>
                                <span style={{ color: 'var(--color-text-tertiary)' }}>{checks.length ? `${checks.length} shots` : 'not run yet'}</span>
                                {mean != null && <span style={{ fontWeight: 700, color: mean >= 0.6 ? '#065F46' : mean >= 0.45 ? '#92400E' : '#991B1B' }}>face score {mean.toFixed(2)} {mean >= 0.6 ? '· pass' : '· below the 0.60 bar'}</span>}
                                {checks.length > 0 && mean == null && <span style={{ color: 'var(--color-text-tertiary)' }}>no scores (scorer not running)</span>}
                              </div>
                              {checks.length > 0 && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
                                  {checks.slice(0, 8).flatMap(r => r.images.map((im, i) => <Tile key={`${r.id}-${i}`} url={im.url} score={im.score} label={r.prompt.replace(/^[a-z0-9]+,\s*/i, '')} />))}
                                </div>
                              )}
                            </div>
                            {others.length > 0 && (
                              <div>
                                <div style={{ fontWeight: 600, marginBottom: 6 }}>Studio results <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{others.length}</span></div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
                                  {others.slice(0, 18).flatMap(r => r.images.map((im, i) => <Tile key={`${r.id}-${i}`} url={im.url} score={im.score} label={r.prompt.replace(/^[a-z0-9]+,\s*/i, '')} />))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>}

        {/* 3. Results (studio) */}
        {section === 'studio' && results.length === 0 && jobs.length === 0 && (
          <div style={{ ...card, fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 28 }}>
            {readyChars.length ? 'Type a prompt below and generate. Results show here and on the version\'s card.' : 'No trained version yet. Build one under Versions.'}
          </div>
        )}
        {section === 'studio' && (results.length > 0 || jobs.length > 0) && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={h}>3 · Try her out</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary) ' }}>Every result is also in the Library{results[0] ? ` (${results[0].name.replace(/_\d+.*$/, '')}_…)` : ''}.</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {jobs.map(j => {
                const secs = Math.max(0, Math.round((now - j.startedAt) / 1000));
                const stage = j.error ? j.error : secs < 8 ? 'Sending to fal...' : secs < 60 ? 'Loading the character (first call can take a few minutes)...' : secs < 240 ? 'Generating...' : 'Still generating (fal is slow right now)...';
                return (
                  <div key={j.id} style={{ borderRadius: 10, overflow: 'hidden', border: `1px dashed ${j.error ? '#FCA5A5' : '#93C5FD'}`, background: j.error ? '#FEF2F2' : '#EFF6FF' }}>
                    <div className={j.error ? '' : 'animate-pulse'} style={{ width: '100%', aspectRatio: '3/4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, textAlign: 'center' }}>
                      {!j.error && <Sparkles size={22} style={{ color: '#2563EB' }} />}
                      <div style={{ fontSize: 12, fontWeight: 600, color: j.error ? '#991B1B' : '#1E40AF' }}>{j.error ? 'Failed' : `${secs}s`}</div>
                      <div style={{ fontSize: 11, color: j.error ? '#991B1B' : '#1E40AF', lineHeight: 1.4 }}>{stage}</div>
                      {j.error && <button style={{ ...smallBtn(), fontSize: 11 }} onClick={() => setJobs(prev => prev.filter(x => x.id !== j.id))}>Dismiss</button>}
                    </div>
                    <div style={{ padding: '6px 8px', fontSize: 10.5, color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.prompt}>{j.scene ? '📎 ' : ''}{j.prompt} · ×{j.n} · {j.scale.toFixed(1)}</div>
                  </div>
                );
              })}
              {results.flatMap(r => r.images.map((u, i) => (
                <div key={`${r.id}-${i}`} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)' }}>
                  {r.sceneUrl ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.poseUrl || r.sceneUrl} alt="" title={r.poseUrl ? 'Pose-only input (mannequin)' : 'Scene input'} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', opacity: 0.7 }} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" onClick={() => setStudioLightbox(flatResults.findIndex(f => f.url === u))} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'contain', background: 'var(--color-bg-tertiary)', cursor: 'zoom-in' }} />
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={u} alt="" onClick={() => setStudioLightbox(flatResults.findIndex(f => f.url === u))} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'contain', background: 'var(--color-bg-tertiary)', display: 'block', cursor: 'zoom-in' }} />
                  )}
                  <div style={{ padding: '6px 8px', fontSize: 10.5, color: 'var(--color-text-secondary)', lineHeight: 1.35 }}>
                    <b>{r.character}</b> · ${r.cost_usd} <ScoreBadge score={scores[u]} style={{ marginLeft: 4 }} /><br />{r.prompt.slice(0, 110)}
                  </div>
                </div>
              )))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ Floating test panel (same shell as Video / Ads) ═══ */}
      {section === 'studio' && <div style={{
        position: 'fixed', bottom: 20, left: 240, right: 20, maxWidth: 'clamp(700px, 75%, 1400px)', margin: '0 auto',
        background: 'var(--color-bg-primary)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.04)', zIndex: 100, display: 'flex', flexDirection: 'column', overflow: 'visible',
      }}>
        <div data-char-dropdown style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', position: 'relative', borderRadius: '20px 20px 0 0' }}>
          <button onClick={() => setCharDropdownOpen(!charDropdownOpen)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#F0F0F3', border: '1px solid rgba(0,0,0,0.09)', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: selectedChar ? '#16A34A' : '#999' }} />
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>{selectedChar ? selectedChar.name : 'No trained character yet'}</span>
            {selectedChar && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{BASES.find(b => b.id === selectedChar.base_model)?.label}</span>}
            <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', transform: charDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          {charDropdownOpen && (
            <div data-char-dropdown style={{ position: 'absolute', top: 52, left: 16, zIndex: 200, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 6, minWidth: 260 }}>
              {readyChars.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: 8 }}>Train a version first.</div>}
              {readyChars.map(c => <ChipOption key={c.id} value={c.id} selected={selectedChar?.id === c.id} label={c.name} hint={`${BASES.find(b => b.id === c.base_model)?.label} · ${c.steps} steps`} onPick={(id) => { setSelectedCharId(id); setCharDropdownOpen(false); }} />)}
            </div>
          )}
          <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.08)', marginLeft: 6 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', flex: 1, marginLeft: 6, position: 'relative', zIndex: 250 }}>
            <SettingsChip dropdownRef={scaleRef} open={showScale} onToggle={() => { setShowScale(!showScale); setShowAspect(false); setShowCount(false); setShowScene(false); }} title="LoRA strength" label={`strength ${scale.toFixed(1)}`} icon={<Sparkles size={14} />}>
              {[0.8, 1.0, 1.2, 2.0, 3.0, 4.0].map(v => <ChipOption key={v} value={v} selected={scale === v} onPick={(x) => { setScale(x); setShowScale(false); }} label={v.toFixed(1)} hint={v < 1 ? 'more prompt' : v > 1.2 ? 'diagnostic: weak LoRA' : v > 1 ? 'more identity' : 'default'} />)}
            </SettingsChip>
            {!sceneUrl && (
              <SettingsChip dropdownRef={aspectRef} open={showAspect} onToggle={() => { setShowAspect(!showAspect); setShowScale(false); setShowCount(false); setShowScene(false); }} title="Ratio" label={aspect} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="3" width="14" height="18" rx="2"/></svg>}>
                {['9:16', '3:4', '1:1', '16:9'].map(v => <ChipOption key={v} value={v} selected={aspect === v} onPick={(x) => { setAspect(x); setShowAspect(false); }} label={v} />)}
              </SettingsChip>
            )}
            {sceneUrl && (
              <SettingsChip dropdownRef={sceneModeRef} open={showScene} onToggle={() => { setShowScene(!showScene); setShowScale(false); setShowAspect(false); setShowCount(false); }} title="Scene" label={sceneMode === 'pose' ? 'scene: pose only' : 'scene: as is'} icon={<Wand2 size={14} />}>
                <ChipOption value="reference" selected={sceneMode === 'reference'} onPick={() => { setSceneMode('reference'); setShowScene(false); }} label="As is" hint="send the photo unchanged" />
                <ChipOption value="pose" selected={sceneMode === 'pose'} onPick={() => { setSceneMode('pose'); setShowScene(false); }} label="Pose only" hint="swap the person for a mannequin first, +$0.04 once" />
              </SettingsChip>
            )}
            <SettingsChip dropdownRef={countRef} open={showCount} onToggle={() => { setShowCount(!showCount); setShowScale(false); setShowAspect(false); setShowScene(false); }} title="Images" label={`${numImages} image${numImages > 1 ? 's' : ''}`} icon={<Image size={14} />}>
              {[1, 2, 4].map(v => <ChipOption key={v} value={v} selected={numImages === v} onPick={(x) => { setNumImages(x); setShowCount(false); }} label={String(v)} />)}
            </SettingsChip>
            <ModelSettings fields={manifestFields} values={activeParamsResolved} onChange={setActiveParams} hide={['num_images']} />
            <span onClick={() => setUpscale(!upscale)} title="Run the 4K upscaler on the result (WaveSpeed image-upscaler). Adds a few seconds and ~$0.01."
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, border: '1px solid', borderColor: upscale ? '#16A34A' : 'var(--color-border)', background: upscale ? 'rgba(22,163,74,0.08)' : 'transparent', color: upscale ? '#065F46' : 'var(--color-text-tertiary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: upscale ? '#16A34A' : '#bbb' }} /> upscale 4K
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-tertiary)' }}>{sceneUrl ? 'replicate photo mode' : 'text mode'} · ~${(numImages * 0.045 + (sceneUrl && sceneMode === 'pose' ? 0.04 : 0)).toFixed(2)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', padding: 14, gap: 14, height: 200, background: '#FAFAFB', borderRadius: '0 0 20px 20px' }}>
          {/* scene slot */}
          <div style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div onClick={() => { if (!selectedCanEdit) { addToast('Pick a trained version first', 'error'); return; } if (!sceneUrl) setScenePickerOpen(true); }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (!selectedCanEdit) return; const f = e.dataTransfer.files?.[0]; if (f) uploadScene(f); }}
              title={selectedChar?.base_model === 'zimage' ? 'Z-Image: scene via WaveSpeed img2img + LoRA (keeps composition, re-renders as her)' : ''}
              style={{ flex: 1, borderRadius: 10, position: 'relative', border: sceneUrl ? 'none' : '2px dashed rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: sceneUrl ? 'transparent' : '#EDEDF0', overflow: 'hidden', gap: 4, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              {sceneUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sceneUrl} alt="Scene" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div onClick={(e) => { e.stopPropagation(); setSceneUrl(''); }} style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={10} style={{ color: '#fff' }} /></div>
                </>
              ) : (
                <>
                  <Image size={20} style={{ opacity: 0.35 }} />
                  <span style={{ fontWeight: 500 }}>Photo to replicate</span>
                  <span style={{ fontSize: 9 }}>optional · pose + setting</span>
                </>
              )}
            </div>
            <button onClick={() => sceneInputRef.current?.click()} style={{ ...smallBtn(), justifyContent: 'center', padding: '4px 8px', fontSize: 11 }}><Upload size={11} /> Upload</button>
            <input ref={sceneInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadScene(f); e.target.value = ''; }} />
          </div>

          {/* prompt */}
          <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value.slice(0, 1500))}
              placeholder={sceneUrl
                ? 'Optional extras: "wearing a black hoodie", "golden hour". The pose and setting come from the photo; her identity comes from the character.'
                : selectedChar ? `Describe the shot. The trigger word (${selectedChar.trigger_word}) is added for you.\n\nExample: half-body, white t-shirt, standing in a bright kitchen holding a coffee cup, morning light, soft smile` : 'Train a character first, then test it here.'}
              style={{ flex: 1, width: '100%', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 10, padding: '10px 12px', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'none', background: '#FFFFFF', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.03)', color: 'var(--color-text-primary)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 4, overflow: 'hidden' }}>
                {!sceneUrl && EXAMPLE_PROMPTS.slice(0, 3).map((ex, i) => (
                  <span key={i} onClick={() => setPrompt(ex)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }} title={ex}>{ex.split(',')[0]}</span>
                ))}
              </div>
              <span style={{ fontSize: 10, color: '#ccc', flexShrink: 0 }}>{prompt.length}/1500</span>
            </div>
          </div>

          {/* generate */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 170 }}>
            <button onClick={generate} disabled={!canGenerate} style={{ width: '100%', padding: '16px 20px', borderRadius: 14, background: canGenerate ? 'linear-gradient(135deg, #0F172A, #1E293B 40%, #334155)' : '#E5E5E5', color: canGenerate ? '#fff' : '#999', border: 'none', cursor: canGenerate ? 'pointer' : 'not-allowed', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: canGenerate ? '0 4px 16px rgba(15,23,42,0.3)' : 'none' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" fill="white"/></svg>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>{jobs.some(j => !j.error) ? `Generate (${jobs.filter(j => !j.error).length} running)` : 'Generate'}</span>
            </button>
            <button onClick={runCheck} disabled={!selectedChar || selectedChar.status !== 'ready' || checking || generating} title="Generates the same 4 shots every time (face, three-quarter, half, full) so versions can be compared"
              style={{ width: '100%', marginTop: 8, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: selectedChar?.status === 'ready' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', fontSize: 12, fontWeight: 600, cursor: selectedChar?.status === 'ready' ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              {checking ? 'Running 4-shot check...' : 'Run 4-shot check (~$0.10)'}
            </button>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
              <kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontSize: 9, fontWeight: 600 }}>Cmd</kbd>{' + '}<kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', fontSize: 9, fontWeight: 600 }}>Enter</kbd>
            </div>
          </div>
        </div>
      </div>}

      {studioLightbox >= 0 && flatResults[studioLightbox] && (
        <ImageLightbox
          images={flatResults.map(f => ({ url: f.url, label: f.r.name }))}
          initialIndex={studioLightbox}
          onClose={() => setStudioLightbox(-1)}
          generationMetas={studioMetas}
          imageMeta={flatResults.map(({ url }) => ({ score: scores[url] ?? null }))}
          actions={{
            onDownload: (i) => {
              const f = flatResults[i]; if (!f) return;
              const a = document.createElement('a'); a.href = f.url; a.download = `${(persona?.name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${f.r.name}_${f.i + 1}.jpg`; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
            },
            onRemix: (i) => { const f = flatResults[i]; if (f) { setSceneUrl(f.url); setSceneMode('reference'); setStudioLightbox(-1); addToast('Set as the scene image', 'success'); } },
          }}
        />
      )}
      <LibraryPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onDone={addFromLibrary} persona={persona?.name || ''} alreadySelected={new Set(dataset.map(d => d.url))} />
      <LibraryPickerModal open={scenePickerOpen} onClose={() => setScenePickerOpen(false)} onDone={(urls) => { if (urls[0]) setSceneUrl(urls[0]); setScenePickerOpen(false); }} persona={persona?.name || ''} alreadySelected={new Set()} />
    </div>
  );
}
