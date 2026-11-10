'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ImageLightbox from './ImageLightbox';
import PromptEditorSection from './PromptEditorSection';

// ─── Types ──────────────────────────────────────────────────

interface RefImage {
  url: string;
  id: string;
}

interface Persona {
  id: string;
  name: string;
  faceRefs: string[];        // URL strings (backward compat)
  bodyRefs: string[];        // URL strings (backward compat)
  faceRefDetails: RefImage[]; // With IDs (for replacement)
  bodyRefDetails: RefImage[]; // With IDs (for replacement)
  traits: string;
  bodyTraits?: string;
  apiProvider: string;
  numImages: number;
  promptProvider: string;
}

// ─── Personal Brand defaults & options ──────────────────────

const BRAND_DEFAULTS = {
  age: 22,
  location: 'Miami, FL',
  archetype: 'Confident beach girl who splits time between gym and pool. Doesn\'t take life too seriously. Lives for golden hour photos and spontaneous road trips.',
  voiceTone: ['flirty', 'playful', 'confident'],
  exampleCaptions: 'caught you staring\nnot sorry about it\nthis pic goes hard idc\nidk what to caption this but I look good',
  contentPillars: ['fitness', 'beach/pool'],
  aestheticStyle: 'Warm & Golden',
  neverSay: 'living my best life, slay, queen, manifest, grateful, journey, embrace',
  neverShow: 'tattoos, piercings, body art, scars, birthmarks',
  captionLength: 'Short (1-2 sentences)',
  platforms: { Instagram: true, 'X/Twitter': true, Threads: true, TikTok: true } as Record<string, boolean>,
  postingFreq: { Instagram: 1, 'X/Twitter': 5, Threads: 1, TikTok: 1 } as Record<string, number>,
  xEngagement: 'Mixed',
  monetization: 'Growth (no links, no CTAs)',
};

const VOICE_TONE_OPTIONS = ['flirty', 'playful', 'confident', 'sarcastic', 'mysterious', 'sweet', 'bold', 'casual', 'witty', 'sultry', 'laid-back', 'energetic', 'dreamy'];
const CONTENT_PILLAR_OPTIONS = ['fitness', 'fashion', 'travel', 'lifestyle', 'beach/pool', 'nightlife', 'luxury', 'streetwear', 'athleisure', 'glam', 'cottagecore', 'urban', 'minimalist'];

// ─── Sub-nav sections ──────────────────────────────────────

const SUB_NAV_SECTIONS = [
  { key: 'general', label: 'General' },
  { key: 'personas', label: 'Personas' },
  { key: 'api-keys', label: 'API Keys' },
  { key: 'prompts', label: 'Prompt Editor' },
  { key: 'providers', label: 'Providers' },
] as const;

type SectionKey = typeof SUB_NAV_SECTIONS[number]['key'];

// ─── API Key definitions ───────────────────────────────────

const API_KEY_ENTRIES = [
  { label: 'Wavespeed', maskedValue: 'sk-wave-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', envKey: 'WAVESPEED_API_KEY' },
  { label: 'xAI (Grok)', maskedValue: 'xai-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', envKey: 'XAI_API_KEY' },
  { label: 'Supabase URL', maskedValue: 'https://\u2022\u2022\u2022\u2022.supabase.co', envKey: 'SUPABASE_URL' },
  { label: 'Late API', maskedValue: 'lt_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', envKey: 'LATE_API_KEY' },
  { label: 'Gemini', maskedValue: 'AIza\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', envKey: 'GEMINI_API_KEY' },
  { label: 'FAL', maskedValue: 'fal_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', envKey: 'FAL_API_KEY' },
];

// ─── Component ──────────────────────────────────────────────

export default function SettingsTab() {
  const [activeSection, setActiveSection] = useState<SectionKey>('general');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePersona, setActivePersona] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Provider config state
  const [primaryProvider, setPrimaryProvider] = useState('wavespeed');
  const [simulate, setSimulate] = useState(false);   // Simulate mode: placeholders instead of provider calls
  const [fallbackProvider, setFallbackProvider] = useState('fal');
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerMessage, setProviderMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Controlled form state (keyed per persona)
  const [editTraits, setEditTraits] = useState('');
  const [editBodyTraits, setEditBodyTraits] = useState('');
  const [editPromptProvider, setEditPromptProvider] = useState('');


  // Image replacement state: { [fieldKey]: { preview: string, base64: string } }
  const [imageReplacements, setImageReplacements] = useState<Record<string, { preview: string; base64: string }>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Lightbox state
  const [lightbox, setLightbox] = useState<{ images: { url: string; label?: string }[]; index: number } | null>(null);

  // Default persona (persisted in localStorage)
  const [defaultPersonaId, setDefaultPersonaId] = useState<string>('');

  // ─── Personal Brand (local-only scaffold) ─────────────────
  const [brandExpanded, setBrandExpanded] = useState(false);
  const [brandAge, setBrandAge] = useState(BRAND_DEFAULTS.age);
  const [brandLocation, setBrandLocation] = useState(BRAND_DEFAULTS.location);
  const [brandArchetype, setBrandArchetype] = useState(BRAND_DEFAULTS.archetype);
  const [brandVoiceTone, setBrandVoiceTone] = useState<string[]>([...BRAND_DEFAULTS.voiceTone]);
  const [brandExampleCaptions, setBrandExampleCaptions] = useState(BRAND_DEFAULTS.exampleCaptions);
  const [brandContentPillars, setBrandContentPillars] = useState<string[]>([...BRAND_DEFAULTS.contentPillars]);
  const [brandAestheticStyle, setBrandAestheticStyle] = useState(BRAND_DEFAULTS.aestheticStyle);
  const [brandNeverSay, setBrandNeverSay] = useState(BRAND_DEFAULTS.neverSay);
  const [brandNeverShow, setBrandNeverShow] = useState(BRAND_DEFAULTS.neverShow);
  const [brandCaptionLength, setBrandCaptionLength] = useState(BRAND_DEFAULTS.captionLength);
  const [brandPlatforms, setBrandPlatforms] = useState<Record<string, boolean>>({ ...BRAND_DEFAULTS.platforms });
  const [brandPostingFreq, setBrandPostingFreq] = useState<Record<string, number>>({ ...BRAND_DEFAULTS.postingFreq });
  const [brandXEngagement, setBrandXEngagement] = useState(BRAND_DEFAULTS.xEngagement);
  const [brandMonetization, setBrandMonetization] = useState(BRAND_DEFAULTS.monetization);

  // API keys edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const currentPersona = personas.find(p => p.id === activePersona);

  function setAsDefault(personaId: string) {
    setDefaultPersonaId(personaId);
    localStorage.setItem('pipeline:defaultPersona', personaId);
  }

  // ─── Load data ──────────────────────────────────────────

  useEffect(() => {
    const storedDefault = localStorage.getItem('pipeline:defaultPersona') || '';
    setDefaultPersonaId(storedDefault);

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setPersonas(data.personas ?? []);
        if (data.personas?.length > 0) {
          const defaultP = storedDefault ? data.personas.find((p: Persona) => p.id === storedDefault) : null;
          const startP = defaultP || data.personas[0];
          setActivePersona(startP.id);
          syncFormState(startP);
        }
      })
      .catch(err => console.error('Failed to fetch config:', err))
      .finally(() => setLoading(false));
  }, []);

  // ─── Sync form when persona changes ─────────────────────

  function syncFormState(persona: Persona) {
    setEditTraits(persona.traits);
    setEditBodyTraits(persona.bodyTraits || '');
    setEditPromptProvider(persona.promptProvider?.toLowerCase()?.includes('grok') ? 'Grok' : 'Gemini');
    setImageReplacements({});
    setSaveMessage(null);
    // Reset Personal Brand fields (no persistence yet)
    setBrandAge(BRAND_DEFAULTS.age);
    setBrandLocation(BRAND_DEFAULTS.location);
    setBrandArchetype(BRAND_DEFAULTS.archetype);
    setBrandVoiceTone([...BRAND_DEFAULTS.voiceTone]);
    setBrandExampleCaptions(BRAND_DEFAULTS.exampleCaptions);
    setBrandContentPillars([...BRAND_DEFAULTS.contentPillars]);
    setBrandAestheticStyle(BRAND_DEFAULTS.aestheticStyle);
    setBrandNeverSay(BRAND_DEFAULTS.neverSay);
    setBrandNeverShow(BRAND_DEFAULTS.neverShow);
    setBrandCaptionLength(BRAND_DEFAULTS.captionLength);
    setBrandPlatforms({ ...BRAND_DEFAULTS.platforms });
    setBrandPostingFreq({ ...BRAND_DEFAULTS.postingFreq });
    setBrandXEngagement(BRAND_DEFAULTS.xEngagement);
    setBrandMonetization(BRAND_DEFAULTS.monetization);
  }

  useEffect(() => {
    if (currentPersona) syncFormState(currentPersona);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePersona]);

  // ─── Load provider config when providers section is active ──
  useEffect(() => {
    if (activeSection !== 'providers') return;
    setProviderLoading(true);
    fetch('/api/provider-config')
      .then(res => res.json())
      .then(data => {
        if (data.primary_provider) setPrimaryProvider(data.primary_provider);
        if (data.fallback_provider) setFallbackProvider(data.fallback_provider);
        setSimulate(data.simulate_generation === 'true');
      })
      .catch(err => console.error('Failed to fetch provider config:', err))
      .finally(() => setProviderLoading(false));
  }, [activeSection]);

  async function saveProviderConfig() {
    setProviderSaving(true);
    setProviderMessage(null);
    try {
      const res = await fetch('/api/provider-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_provider: primaryProvider, fallback_provider: fallbackProvider, simulate_generation: simulate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setProviderMessage({ type: 'success', text: 'Provider config saved' });
    } catch (err) {
      setProviderMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setProviderSaving(false);
    }
  }

  // ─── File handling ──────────────────────────────────────

  const handleImageReplace = useCallback((key: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    const preview = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setImageReplacements(prev => ({
        ...prev,
        [key]: { preview, base64 },
      }));
    };
    reader.readAsDataURL(file);
  }, []);

  function clearReplacement(key: string) {
    setImageReplacements(prev => {
      const next = { ...prev };
      if (next[key]?.preview) URL.revokeObjectURL(next[key].preview);
      delete next[key];
      return next;
    });
  }

  function triggerFileInput(key: string) {
    const input = fileInputRefs.current[key];
    if (input) {
      input.value = '';
      input.click();
    }
  }

  // ─── Get display URL (replacement preview or original) ──

  function getImageUrl(field: 'face' | 'body', index: number): string {
    const key = `${field}_${index}`;
    if (imageReplacements[key]) return imageReplacements[key].preview;
    const refs = field === 'face' ? currentPersona?.faceRefDetails : currentPersona?.bodyRefDetails;
    return refs?.[index]?.url || '';
  }

  function isReplaced(field: 'face' | 'body', index: number): boolean {
    return !!imageReplacements[`${field}_${index}`];
  }

  // ─── Check if anything changed ──────────────────────────

  function hasChanges(): boolean {
    if (!currentPersona) return false;
    if (editTraits !== currentPersona.traits) return true;
    if (editBodyTraits !== (currentPersona.bodyTraits || '')) return true;
    const currentProvider = currentPersona.promptProvider?.toLowerCase()?.includes('grok') ? 'Grok' : 'Gemini';
    if (editPromptProvider !== currentProvider) return true;
    if (Object.keys(imageReplacements).length > 0) return true;
    return false;
  }

  // ─── Save handler ───────────────────────────────────────

  async function handleSave() {
    if (!currentPersona) return;
    setSaving(true);
    setSaveMessage(null);

    try {
      // Build request body
      const body: Record<string, unknown> = {
        personaId: currentPersona.id,
        traits: editTraits,
        bodyTraits: editBodyTraits,
        promptProvider: editPromptProvider,
      };

      // Collect image replacements
      const faceReplacements: { index: number; base64: string; filename: string }[] = [];
      const bodyReplacements: { index: number; base64: string; filename: string }[] = [];

      for (const [key, val] of Object.entries(imageReplacements)) {
        const [field, indexStr] = key.split('_');
        const index = parseInt(indexStr);
        const entry = { index, base64: val.base64, filename: `${field}_ref_${index + 1}.jpg` };
        if (field === 'face') faceReplacements.push(entry);
        if (field === 'body') bodyReplacements.push(entry);
      }

      if (faceReplacements.length > 0) body.replaceFaceRefs = faceReplacements;
      if (bodyReplacements.length > 0) body.replaceBodyRefs = bodyReplacements;

      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${res.status})`);
      }

      // Refetch to get updated data (including new image URLs)
      const configRes = await fetch('/api/config');
      if (configRes.ok) {
        const configData = await configRes.json();
        setPersonas(configData.personas ?? []);
      }

      // Clear replacements (new URLs will come from refetch)
      for (const val of Object.values(imageReplacements)) {
        if (val.preview) URL.revokeObjectURL(val.preview);
      }
      setImageReplacements({});

      setSaveMessage({ type: 'success', text: 'Configuration saved' });
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setSaveMessage({ type: 'error', text: errMsg });
    } finally {
      setSaving(false);
    }
  }

  // ─── Image card component ──────────────────────────────

  function ImageCard({ field, index, aspect }: { field: 'face' | 'body'; index: number; aspect: string }) {
    const key = `${field}_${index}`;
    const url = getImageUrl(field, index);
    const replaced = isReplaced(field, index);
    const allUrls = [0, 1].map(i => getImageUrl(field, i)).filter(Boolean);

    return (
      <div className="relative rounded-lg overflow-hidden border group" style={{ borderColor: replaced ? 'var(--color-accent-green)' : 'var(--color-border)', aspectRatio: aspect }}>
        {/* Hidden file input */}
        <input
          ref={el => { fileInputRefs.current[key] = el; }}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleImageReplace(key, e.target.files[0]); }}
        />

        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${field} ref ${index + 1}`}
              className="w-full h-full object-cover cursor-pointer"
              onClick={() => setLightbox({
                images: allUrls.map((u, i) => ({ url: u, label: `${field === 'face' ? 'Face' : 'Body'} Reference ${i + 1}` })),
                index,
              })}
            />
            {/* Replaced badge */}
            {replaced && (
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'var(--color-accent-green)', color: '#fff' }}>
                New
              </div>
            )}
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex items-center justify-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); triggerFileInput(key); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm"
                style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
              >
                Replace
              </button>
              {replaced && (
                <button
                  onClick={(e) => { e.stopPropagation(); clearReplacement(key); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm"
                  style={{ background: 'rgba(220,53,69,0.4)', color: 'white' }}
                >
                  Undo
                </button>
              )}
            </div>
            {/* Expand icon */}
            <button
              onClick={() => setLightbox({
                images: allUrls.map((u, i) => ({ url: u, label: `${field === 'face' ? 'Face' : 'Body'} Reference ${i + 1}` })),
                index,
              })}
              className="absolute top-2 right-2 w-7 h-7 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(0,0,0,0.5)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
            style={{ background: 'var(--color-bg-tertiary)' }}
            onClick={() => triggerFileInput(key)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-[10px] mt-1" style={{ color: '#999' }}>Add image</span>
          </div>
        )}
      </div>
    );
  }

  // ─── Toggle switch component ───────────────────────────

  function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none"
        style={{
          width: 40,
          height: 22,
          background: checked ? 'var(--color-accent-green)' : '#D1D5DB',
        }}
      >
        <span
          className="pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out"
          style={{
            width: 18,
            height: 18,
            marginTop: 2,
            marginLeft: checked ? 20 : 2,
          }}
        />
      </button>
    );
  }

  // ─── Loading skeleton ───────────────────────────────────

  if (loading) {
    return (
      <div className="flex fade-in" style={{ minHeight: 500 }}>
        {/* Left nav skeleton */}
        <div style={{ width: 180, borderRight: '1px solid var(--color-border)', padding: '20px 12px' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton rounded-md" style={{ height: 32, marginBottom: 2 }} />
          ))}
        </div>
        {/* Right content skeleton */}
        <div style={{ flex: 1, maxWidth: 640, padding: '28px 32px' }}>
          <div className="skeleton rounded-lg" style={{ width: 120, height: 20, marginBottom: 8 }} />
          <div className="skeleton rounded-lg" style={{ width: 240, height: 14, marginBottom: 24 }} />
          <div className="space-y-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i}>
                <div className="skeleton rounded-lg" style={{ width: 100, height: 12, marginBottom: 8 }} />
                <div className="skeleton rounded-lg" style={{ width: '100%', height: 38 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Section content renderers ─────────────────────────

  function renderGeneral() {
    return (
      <div className="space-y-7">
        {/* Section header */}
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>General</h3>
          <p style={{ fontSize: 12, color: '#999' }}>Default settings for image generation pipeline.</p>
        </div>

        {/* Default Persona */}
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Default Persona</label>
          <select
            value={defaultPersonaId}
            onChange={(e) => setAsDefault(e.target.value)}
            className="w-full rounded-md border text-sm outline-none transition-colors"
            style={{
              background: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '8px 12px',
              maxWidth: 320,
            }}
          >
            <option value="">No default</option>
            {personas.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Default Model */}
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Default Model</label>
          <select
            defaultValue="nanobanana-pro"
            className="w-full rounded-md border text-sm outline-none transition-colors"
            style={{
              background: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '8px 12px',
              maxWidth: 320,
            }}
          >
            <option value="nanobanana-pro">Nanobanana Pro (4K)</option>
            <option value="nanobanana-2">Nanobanana 2</option>
            <option value="seedream-4.5">Seedream 4.5</option>
            <option value="seedream-4.0">Seedream 4.0</option>
          </select>
        </div>

        {/* Default Image Count */}
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Default Image Count</label>
          <select
            defaultValue={currentPersona?.numImages?.toString() ?? '4'}
            className="rounded-md border text-sm outline-none transition-colors"
            style={{
              background: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '8px 12px',
              width: 100,
            }}
          >
            {[1, 2, 3, 4, 5, 6, 8].map(n => (
              <option key={n} value={n.toString()}>{n}</option>
            ))}
          </select>
        </div>

        {/* Wavespeed Tier */}
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Wavespeed Tier</label>
          <select
            defaultValue="bronze"
            className="w-full rounded-md border text-sm outline-none transition-colors"
            style={{
              background: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '8px 12px',
              maxWidth: 320,
            }}
          >
            <option value="bronze">Bronze (3 concurrent)</option>
            <option value="silver">Silver (100 concurrent)</option>
            <option value="gold">Gold (200 concurrent)</option>
          </select>
        </div>
      </div>
    );
  }

  function renderPersonas() {
    return (
      <div className="space-y-7">
        {/* Section header */}
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>Personas</h3>
          <p style={{ fontSize: 12, color: '#999' }}>Manage persona configurations, reference images, and traits.</p>
        </div>

        {/* Persona Selector */}
        <div className="flex gap-3 flex-wrap">
          {personas.map(p => (
            <div
              key={p.id}
              onClick={() => setActivePersona(p.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-200 cursor-pointer"
              style={{
                background: activePersona === p.id ? 'var(--color-bg-active)' : 'var(--color-bg-primary)',
                borderColor: activePersona === p.id ? '#93C5FD' : 'var(--color-border)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.faceRefs?.[0] || ''} alt={p.name} className="w-9 h-9 rounded-full object-cover" style={{ border: '2px solid var(--color-border)' }} />
              <div className="text-left">
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{p.name}</div>
                {defaultPersonaId === p.id && (
                  <div className="text-[10px] font-medium" style={{ color: 'var(--color-accent-blue-text)' }}>Default</div>
                )}
              </div>
              {/* Default star */}
              <button
                onClick={(e) => { e.stopPropagation(); setAsDefault(p.id); }}
                className="ml-2 p-1 rounded-md transition-colors hover:bg-black/5"
                title={defaultPersonaId === p.id ? 'Default persona' : 'Set as default'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={defaultPersonaId === p.id ? '#1E40AF' : 'none'} stroke={defaultPersonaId === p.id ? '#1E40AF' : '#999'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* Reference Images */}
        <div className="grid grid-cols-2 gap-6">
          {/* Face References */}
          <div>
            <label className="block text-xs font-semibold mb-3" style={{ color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Face References
            </label>
            <div className="grid grid-cols-2 gap-3">
              <ImageCard field="face" index={0} aspect="3/4" />
              <ImageCard field="face" index={1} aspect="3/4" />
            </div>
          </div>

          {/* Body References */}
          <div>
            <label className="block text-xs font-semibold mb-3" style={{ color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Body References
            </label>
            <div className="grid grid-cols-2 gap-3">
              <ImageCard field="body" index={0} aspect="3/4" />
              <ImageCard field="body" index={1} aspect="3/4" />
            </div>
          </div>
        </div>

        {/* Model Traits */}
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Model Traits</label>
          <textarea
            value={editTraits}
            onChange={(e) => setEditTraits(e.target.value)}
            rows={3}
            className="w-full rounded-md border px-3 py-2.5 text-sm resize-none outline-none transition-colors placeholder:opacity-40"
            style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
            onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
          />
        </div>

        {/* Body Traits (stored for character mode; not yet added to prompts) */}
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Body Traits</label>
          <textarea
            value={editBodyTraits}
            onChange={(e) => setEditBodyTraits(e.target.value)}
            rows={2}
            placeholder="Height, build, proportions, tattoos, marks. Kept the same in every image."
            className="w-full rounded-md border px-3 py-2.5 text-sm resize-none outline-none transition-colors placeholder:opacity-40"
            style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
            onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
          />
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>Saved to the persona. Not sent with prompts yet.</p>
        </div>

        {/* AI Provider */}
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>AI Provider</label>
          <select
            value={editPromptProvider}
            onChange={(e) => setEditPromptProvider(e.target.value)}
            className="rounded-md border text-sm cursor-pointer outline-none"
            style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', padding: '8px 12px', maxWidth: 240 }}
          >
            <option value="Gemini">Gemini 2.5 Flash</option>
            <option value="Grok">Grok</option>
          </select>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges()}
            className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'var(--color-accent-green)',
              color: '#ffffff',
            }}
          >
            {saving ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                Saving...
              </>
            ) : (
              'Save Configuration'
            )}
          </button>
          {saveMessage && (
            <span className="text-xs font-medium px-3 py-1.5 rounded-md" style={{
              background: saveMessage.type === 'success' ? 'var(--color-success-muted)' : 'var(--color-error-muted)',
              color: saveMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
            }}>
              {saveMessage.text}
            </span>
          )}
          {!saveMessage && !saving && (
            <span className="text-xs" style={{ color: '#999' }}>
              {hasChanges() ? 'Unsaved changes' : 'Saved'}
            </span>
          )}
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--color-border)' }} />

        {/* Personal Brand (collapsible) */}
        <div>
          <button
            onClick={() => setBrandExpanded(!brandExpanded)}
            className="w-full flex items-center justify-between py-1 group"
          >
            <h3 style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Personal Brand
            </h3>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="#999" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: brandExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {brandExpanded && (
            <div className="space-y-6 pt-4 fade-in">
              {/* Info banner */}
              <div
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-md text-xs leading-relaxed"
                style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                </svg>
                <span>These fields are not yet connected to the database. Changes will not persist between sessions.</span>
              </div>

              {/* Identity */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#999' }}>Identity</p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Display Name</label>
                    <input type="text" readOnly value={currentPersona?.name || ''} className="w-full px-3 py-2 rounded-md border text-sm outline-none cursor-default" style={{ background: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border)', color: '#666' }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Age</label>
                    <input type="number" min={18} max={35} value={brandAge} onChange={(e) => setBrandAge(Math.max(18, Math.min(35, parseInt(e.target.value) || 18)))} className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-colors" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }} onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'} onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Location</label>
                    <input type="text" value={brandLocation} onChange={(e) => setBrandLocation(e.target.value)} placeholder="Miami, FL" className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-colors placeholder:opacity-40" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }} onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'} onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'} />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Archetype / Bio</label>
                  <textarea value={brandArchetype} onChange={(e) => setBrandArchetype(e.target.value)} rows={3} placeholder="Confident beach girl who splits time between gym and pool..." className="w-full rounded-md border px-3 py-2.5 text-sm resize-none outline-none transition-colors placeholder:opacity-40" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }} onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'} onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'} />
                </div>
              </div>

              {/* Voice & Content */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#999' }}>Voice & Content</p>
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Voice Tone</label>
                  <div className="flex flex-wrap gap-2">
                    {VOICE_TONE_OPTIONS.map(tone => {
                      const selected = brandVoiceTone.includes(tone);
                      return (
                        <button key={tone} onClick={() => { if (selected) { setBrandVoiceTone(prev => prev.filter(t => t !== tone)); } else { setBrandVoiceTone(prev => [...prev, tone]); } }} className="px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150" style={{ background: selected ? 'var(--color-accent-green)' : 'transparent', borderColor: selected ? 'var(--color-accent-green)' : 'var(--color-border)', color: selected ? '#ffffff' : '#666' }}>
                          {tone}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Example Captions <span className="font-normal opacity-60">(one per line)</span></label>
                  <textarea value={brandExampleCaptions} onChange={(e) => setBrandExampleCaptions(e.target.value)} rows={4} placeholder={'caught you staring\nnot sorry about it'} className="w-full rounded-md border px-3 py-2.5 text-sm resize-none outline-none transition-colors placeholder:opacity-40" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }} onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'} onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'} />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Content Pillars</label>
                  <div className="flex flex-wrap gap-2">
                    {CONTENT_PILLAR_OPTIONS.map(pillar => {
                      const selected = brandContentPillars.includes(pillar);
                      return (
                        <button key={pillar} onClick={() => { if (selected) { setBrandContentPillars(prev => prev.filter(p => p !== pillar)); } else { setBrandContentPillars(prev => [...prev, pillar]); } }} className="px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150" style={{ background: selected ? 'var(--color-accent-green)' : 'transparent', borderColor: selected ? 'var(--color-accent-green)' : 'var(--color-border)', color: selected ? '#ffffff' : '#666' }}>
                          {pillar}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Aesthetic Style</label>
                  <select value={brandAestheticStyle} onChange={(e) => setBrandAestheticStyle(e.target.value)} className="rounded-md border text-sm cursor-pointer outline-none" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', padding: '8px 12px', maxWidth: 240 }}>
                    {['Clean & Minimal', 'Warm & Golden', 'Moody & Dark', 'Bright & Colorful', 'Soft & Dreamy', 'Editorial / High Fashion', 'Raw & Natural'].map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Guardrails */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#999' }}>Guardrails</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Never Say <span className="font-normal opacity-60">(comma-separated)</span></label>
                    <textarea value={brandNeverSay} onChange={(e) => setBrandNeverSay(e.target.value)} rows={2} placeholder="living my best life, slay, queen" className="w-full rounded-md border px-3 py-2.5 text-sm resize-none outline-none transition-colors placeholder:opacity-40" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }} onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'} onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Never Show <span className="font-normal opacity-60">(comma-separated)</span></label>
                    <textarea value={brandNeverShow} onChange={(e) => setBrandNeverShow(e.target.value)} rows={2} placeholder="tattoos, piercings, body art" className="w-full rounded-md border px-3 py-2.5 text-sm resize-none outline-none transition-colors placeholder:opacity-40" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }} onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'} onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'} />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Caption Length</label>
                  <select value={brandCaptionLength} onChange={(e) => setBrandCaptionLength(e.target.value)} className="rounded-md border text-sm cursor-pointer outline-none" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', padding: '8px 12px', maxWidth: 240 }}>
                    {['Short (1-2 sentences)', 'Medium (2-3 sentences)', 'Long (paragraph)'].map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Strategy */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#999' }}>Strategy</p>
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Platforms Active</label>
                  <div className="flex flex-wrap gap-4">
                    {['Instagram', 'X/Twitter', 'Threads', 'TikTok'].map(platform => (
                      <label key={platform} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={brandPlatforms[platform] ?? false} onChange={(e) => setBrandPlatforms(prev => ({ ...prev, [platform]: e.target.checked }))} className="w-4 h-4 rounded accent-emerald-600" />
                        <span className="text-sm" style={{ color: '#666' }}>{platform}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Posting Frequency <span className="font-normal opacity-60">(posts/day)</span></label>
                  <div className="grid grid-cols-4 gap-3">
                    {['Instagram', 'X/Twitter', 'Threads', 'TikTok'].map(platform => (
                      <div key={platform}>
                        <label className="block text-[10px] mb-1" style={{ color: '#999' }}>{platform}</label>
                        <input type="number" min={0} max={20} value={brandPostingFreq[platform] ?? 1} onChange={(e) => setBrandPostingFreq(prev => ({ ...prev, [platform]: Math.max(0, Math.min(20, parseInt(e.target.value) || 0)) }))} className="w-full px-3 py-2 rounded-md border text-sm outline-none transition-colors" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }} onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'} onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>X Engagement Style</label>
                    <select value={brandXEngagement} onChange={(e) => setBrandXEngagement(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm cursor-pointer outline-none" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                      {['Questions (reply-bait)', 'Statements (hot takes)', 'Mixed'].map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#999' }}>Monetization Stage</label>
                    <select value={brandMonetization} onChange={(e) => setBrandMonetization(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm cursor-pointer outline-none" style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                      {['Growth (no links, no CTAs)', 'Early Monetization (safe CTAs only)', 'Established (link in bio, subscription CTAs)'].map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderApiKeys() {
    return (
      <div className="space-y-6">
        {/* Section header */}
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>API Keys</h3>
          <p style={{ fontSize: 12, color: '#999' }}>Manage API credentials for connected services. Keys are stored in .env.local.</p>
        </div>

        {/* Key list */}
        <div className="space-y-0">
          {API_KEY_ENTRIES.map((entry, idx) => (
            <div key={entry.label}>
              <div className="flex items-center justify-between py-3.5">
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: 3 }}>{entry.label}</label>
                  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#999', letterSpacing: '0.02em' }}>
                    {entry.maskedValue}
                  </span>
                </div>
                <button
                  onClick={() => setEditingKey(editingKey === entry.envKey ? null : entry.envKey)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: editingKey === entry.envKey ? 'var(--color-bg-active)' : 'var(--color-bg-tertiary)',
                    color: editingKey === entry.envKey ? 'var(--color-accent-blue-text)' : '#666',
                  }}
                >
                  {editingKey === entry.envKey ? 'Done' : 'Edit'}
                </button>
              </div>
              {editingKey === entry.envKey && (
                <div className="pb-3 fade-in">
                  <input
                    type="text"
                    placeholder={`Enter ${entry.label} key...`}
                    className="w-full px-3 py-2 rounded-md border text-xs outline-none transition-colors"
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      background: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                  />
                </div>
              )}
              {idx < API_KEY_ENTRIES.length - 1 && (
                <div style={{ borderTop: '1px solid var(--color-border)' }} />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderPromptEditor() {
    return (
      <div>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>Prompt Editor</h3>
          <p style={{ fontSize: 12, color: '#999' }}>Edit prompt templates used across generation and remix pipelines.</p>
        </div>
        <PromptEditorSection />
      </div>
    );
  }

  function renderProviders() {
    return (
      <div className="space-y-6">
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>Providers</h3>
          <p style={{ fontSize: 12, color: '#999' }}>
            Choose which image generation provider to use first. If the primary provider fails or times out, the fallback provider will be tried automatically.
          </p>
        </div>

        {providerLoading ? (
          <div className="text-sm" style={{ color: '#999' }}>Loading provider config...</div>
        ) : (
          <div className="space-y-5">
            {/* Primary Provider */}
            <div>
              <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                Primary Provider
              </label>
              <div className="flex gap-3">
                {[
                  { value: 'wavespeed', label: 'Wavespeed', desc: 'Nanobanana Pro/2, Seedream 4.0/4.5' },
                  { value: 'fal', label: 'fal.ai', desc: 'Nanobanana Pro/2, Seedream 4.0/4.5' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setPrimaryProvider(opt.value);
                      if (fallbackProvider === opt.value) {
                        setFallbackProvider(opt.value === 'wavespeed' ? 'fal' : 'wavespeed');
                      }
                      setProviderMessage(null);
                    }}
                    className="flex-1 p-4 rounded-lg text-left transition-all duration-200"
                    style={{
                      background: primaryProvider === opt.value ? 'var(--color-bg-active)' : 'var(--color-bg-primary)',
                      border: `2px solid ${primaryProvider === opt.value ? '#93C5FD' : 'var(--color-border)'}`,
                    }}
                  >
                    <div className="text-sm font-semibold" style={{ color: primaryProvider === opt.value ? 'var(--color-accent-blue-text)' : 'var(--color-text-primary)' }}>
                      {opt.label}
                    </div>
                    <div className="text-xs mt-1" style={{ color: '#999' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Fallback Provider */}
            <div>
              <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                Fallback Provider
              </label>
              <div className="flex gap-3">
                {[
                  { value: 'wavespeed', label: 'Wavespeed' },
                  { value: 'fal', label: 'fal.ai' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setFallbackProvider(opt.value);
                      if (primaryProvider === opt.value) {
                        setPrimaryProvider(opt.value === 'wavespeed' ? 'fal' : 'wavespeed');
                      }
                      setProviderMessage(null);
                    }}
                    className="flex-1 p-3 rounded-lg text-left transition-all duration-200"
                    style={{
                      background: fallbackProvider === opt.value ? 'var(--color-bg-active)' : 'var(--color-bg-primary)',
                      border: `2px solid ${fallbackProvider === opt.value ? '#93C5FD' : 'var(--color-border)'}`,
                    }}
                  >
                    <div className="text-sm font-semibold" style={{ color: fallbackProvider === opt.value ? 'var(--color-accent-blue-text)' : 'var(--color-text-primary)' }}>
                      {opt.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Info box */}
            <div className="p-4 rounded-lg text-sm" style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
              <div style={{ color: '#666' }}>
                <strong>Current flow:</strong> Generations will try <span style={{ color: 'var(--color-accent-blue-text)', fontWeight: 600 }}>{primaryProvider === 'wavespeed' ? 'Wavespeed' : 'fal.ai'}</span> first.
                If it fails or times out (~2 min), it falls back to <span style={{ fontWeight: 600 }}>{fallbackProvider === 'wavespeed' ? 'Wavespeed' : 'fal.ai'}</span>.
              </div>
            </div>

            {/* Simulate mode */}
            <label className="p-4 rounded-lg text-sm flex items-start gap-3" style={{ background: simulate ? 'rgba(245,158,11,0.10)' : 'var(--color-bg-tertiary)', border: `1px solid ${simulate ? '#F59E0B' : 'var(--color-border)'}`, cursor: 'pointer' }}>
              <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                <strong style={{ color: 'var(--color-text-primary)' }}>Simulate image generation</strong>
                <span style={{ display: 'block', color: '#666', marginTop: 2 }}>
                  Create, Copy, Remix and Carousel return a grey SIMULATED placeholder and make no image call. Video, training, Character Studio and Ads refuse to run while this is on. Prompt writing (Grok) still runs. Click Save to apply.
                </span>
              </span>
            </label>

            {/* Save button */}
            <div className="flex items-center gap-4">
              <button
                onClick={saveProviderConfig}
                disabled={providerSaving}
                className="px-5 py-2 rounded-md text-sm font-semibold transition-all duration-200"
                style={{
                  background: 'var(--color-accent-green)',
                  color: '#ffffff',
                  opacity: providerSaving ? 0.6 : 1,
                }}
              >
                {providerSaving ? 'Saving...' : 'Save Provider Config'}
              </button>
              {providerMessage && (
                <span className="text-sm" style={{ color: providerMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {providerMessage.text}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="flex fade-in" style={{ minHeight: 500 }}>
      {/* Left Sub-Nav */}
      <div
        style={{
          width: 180,
          borderRight: '1px solid var(--color-border)',
          padding: '20px 12px',
          flexShrink: 0,
        }}
      >
        <nav className="space-y-0.5">
          {SUB_NAV_SECTIONS.map(section => {
            const isActive = activeSection === section.key;
            return (
              <button
                key={section.key}
                onClick={() => setActiveSection(section.key)}
                className="block w-full text-left transition-colors duration-150"
                style={{
                  fontSize: 12,
                  padding: '8px 10px',
                  marginBottom: 2,
                  borderRadius: 6,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? '#DBEAFE' : 'transparent',
                  color: isActive ? '#1E40AF' : '#999',
                }}
              >
                {section.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right Content Area */}
      <div
        ref={contentRef}
        style={{
          flex: 1,
          maxWidth: 640,
          padding: '28px 32px',
          overflowY: 'auto',
        }}
      >
        {activeSection === 'general' && renderGeneral()}
        {activeSection === 'personas' && renderPersonas()}
        {activeSection === 'api-keys' && renderApiKeys()}
        {activeSection === 'prompts' && renderPromptEditor()}
        {activeSection === 'providers' && renderProviders()}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
