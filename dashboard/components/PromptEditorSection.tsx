'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface PromptTemplate {
  key: string;
  label: string;
  description: string;
  route: 'generate' | 'remix' | 'caption' | 'carousel';
  step: number;
  content: string;
  source: 'default' | 'custom';
  updatedAt: string | null;
}

interface Preamble {
  label: string;
  description: string;
  content: string;
  step: number;
}

// ─── Step Header ────────────────────────────────────────────

function StepHeader({ step, label, isReadOnly }: { step: number; label: string; isReadOnly?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div
        className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0"
        style={{
          background: isReadOnly ? 'var(--color-bg-tertiary)' : 'var(--color-accent-green-muted)',
          color: isReadOnly ? 'var(--color-text-tertiary)' : 'var(--color-accent-green)',
          border: `1.5px solid ${isReadOnly ? 'var(--color-border)' : 'var(--color-accent-green)'}`,
        }}
      >
        {step}
      </div>
      <span
        className="text-sm font-semibold tracking-wide uppercase"
        style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}
      >
        {label}
      </span>
      {isReadOnly && (
        <span
          className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Read-Only
        </span>
      )}
    </div>
  );
}

// ─── Flow Connector ─────────────────────────────────────────

function FlowConnector() {
  return (
    <div className="flex justify-start pl-[13px] py-1">
      <div className="w-px h-6" style={{ background: 'var(--color-border)' }} />
    </div>
  );
}

// ─── Preamble Card (Read-Only) ──────────────────────────────

function PreambleCard({ preamble }: { preamble: Preamble }) {
  return (
    <div
      className="rounded-xl border"
      style={{
        background: 'var(--color-bg-primary)',
        borderColor: 'var(--color-border)',
        borderStyle: 'dashed',
      }}
    >
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
          {preamble.description}
        </p>
      </div>
      <div className="px-4 pb-4">
        <div
          className="rounded-lg px-3 py-2.5 text-xs leading-relaxed font-mono select-all"
          style={{
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {preamble.content}
        </div>
      </div>
    </div>
  );
}

// ─── Editable Template Card ─────────────────────────────────

function TemplateCard({
  template,
  editValue,
  onEdit,
  onSave,
  onReset,
  saving,
  flashing,
}: {
  template: PromptTemplate;
  editValue: string;
  onEdit: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  flashing: boolean;
}) {
  const unsaved = editValue !== template.content;
  const isKeyword = template.key.includes('keywords:');
  const isCaption = template.route === 'caption';

  return (
    <div
      className="rounded-xl border transition-all duration-300"
      style={{
        background: 'var(--color-bg-primary)',
        borderColor: flashing ? 'var(--color-success)' : 'var(--color-border)',
        boxShadow: flashing ? '0 0 20px var(--color-success-muted)' : 'none',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
              {template.label}
            </span>
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: template.source === 'custom' ? 'var(--color-accent-green-muted)' : 'var(--color-bg-tertiary)',
                color: template.source === 'custom' ? 'var(--color-accent-green)' : 'var(--color-text-tertiary)',
              }}
            >
              {template.source === 'custom' ? 'Custom' : 'Default'}
            </span>
          </div>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>{template.description}</p>
        </div>
      </div>

      {/* Textarea */}
      <div className="px-4 pb-2">
        <textarea
          value={editValue}
          onChange={(e) => onEdit(e.target.value)}
          rows={isCaption ? 6 : isKeyword ? 8 : 15}
          placeholder={isCaption ? 'e.g. "Always end captions with a teasing question. Never mention fashion brands. Use a more mysterious, aloof tone instead of bubbly."' : undefined}
          className="w-full rounded-lg border px-3 py-2.5 text-xs leading-relaxed resize-y outline-none transition-colors font-mono"
          style={{
            background: 'var(--color-bg-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            minHeight: isCaption ? '100px' : isKeyword ? '120px' : '200px',
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 px-4 pb-4">
        <button
          onClick={onSave}
          disabled={saving || !unsaved}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{
            background: unsaved ? 'var(--color-accent-green)' : 'var(--color-bg-tertiary)',
            color: unsaved ? '#ffffff' : 'var(--color-text-tertiary)',
          }}
        >
          {saving ? (
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
          ) : null}
          Save
        </button>

        {template.source === 'custom' && (
          <button
            onClick={onReset}
            disabled={saving}
            className="text-xs font-medium transition-colors hover:underline disabled:opacity-40"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Reset to Default
          </button>
        )}

        {unsaved && (
          <span className="text-[10px] font-medium" style={{ color: 'var(--color-warning)' }}>
            Unsaved changes
          </span>
        )}

        {flashing && (
          <span className="text-[10px] font-medium" style={{ color: 'var(--color-success)' }}>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Keyword Step (grouped with model sub-tabs) ─────────────

function KeywordStep({
  templates,
  edits,
  onEdit,
  onSave,
  onReset,
  savingKey,
  flashKey,
}: {
  templates: PromptTemplate[];
  edits: Record<string, string>;
  onEdit: (key: string, value: string) => void;
  onSave: (key: string) => void;
  onReset: (key: string) => void;
  savingKey: string | null;
  flashKey: string | null;
}) {
  const [activeModel, setActiveModel] = useState(0);

  if (templates.length === 0) return null;

  const active = templates[activeModel];
  if (!active) return null;

  return (
    <div
      className="rounded-xl border"
      style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border)' }}
    >
      {/* Model sub-tabs */}
      <div className="flex gap-1 px-4 pt-4 pb-2">
        {templates.map((t, i) => (
          <button
            key={t.key}
            onClick={() => setActiveModel(i)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
            style={{
              background: activeModel === i ? 'var(--color-bg-tertiary)' : 'transparent',
              color: activeModel === i ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              border: `1px solid ${activeModel === i ? 'var(--color-accent-green)' : 'transparent'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Description */}
      <div className="px-4 pb-2">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
          {active.description}
        </p>
      </div>

      {/* Active template textarea */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: active.source === 'custom' ? 'var(--color-accent-green-muted)' : 'var(--color-bg-tertiary)',
              color: active.source === 'custom' ? 'var(--color-accent-green)' : 'var(--color-text-tertiary)',
            }}
          >
            {active.source === 'custom' ? 'Custom' : 'Default'}
          </span>
        </div>
        <textarea
          value={edits[active.key] ?? ''}
          onChange={(e) => onEdit(active.key, e.target.value)}
          rows={8}
          className="w-full rounded-lg border px-3 py-2.5 text-xs leading-relaxed resize-y outline-none transition-colors font-mono"
          style={{
            background: 'var(--color-bg-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            minHeight: '120px',
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 px-4 pb-4">
        <button
          onClick={() => onSave(active.key)}
          disabled={savingKey === active.key || edits[active.key] === active.content}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{
            background: edits[active.key] !== active.content ? 'var(--color-accent-green)' : 'var(--color-bg-tertiary)',
            color: edits[active.key] !== active.content ? '#ffffff' : 'var(--color-text-tertiary)',
          }}
        >
          {savingKey === active.key ? (
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
          ) : null}
          Save
        </button>

        {active.source === 'custom' && (
          <button
            onClick={() => onReset(active.key)}
            disabled={savingKey === active.key}
            className="text-xs font-medium transition-colors hover:underline disabled:opacity-40"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Reset to Default
          </button>
        )}

        {edits[active.key] !== active.content && (
          <span className="text-[10px] font-medium" style={{ color: 'var(--color-warning)' }}>
            Unsaved changes
          </span>
        )}

        {flashKey === active.key && (
          <span className="text-[10px] font-medium" style={{ color: 'var(--color-success)' }}>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function PromptEditorSection() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [preambles, setPreambles] = useState<Record<string, Preamble>>({});
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<'generate' | 'remix' | 'caption' | 'carousel'>('generate');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  // ─── Fetch templates ──────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/prompt-templates');
      const data = await res.json();
      if (data.templates) {
        setTemplates(data.templates);
        const editMap: Record<string, string> = {};
        for (const t of data.templates) {
          editMap[t.key] = t.content;
        }
        setEdits(editMap);
      }
      if (data.preambles) {
        setPreambles(data.preambles);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // ─── Handlers ──────────────────────────────────────────────

  async function handleSave(key: string) {
    setSavingKey(key);
    try {
      const res = await fetch('/api/prompt-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, content: edits[key] }),
      });
      if (res.ok) {
        setTemplates(prev => prev.map(t =>
          t.key === key ? { ...t, content: edits[key], source: 'custom' as const, updatedAt: new Date().toISOString() } : t
        ));
        setFlashKey(key);
        setTimeout(() => setFlashKey(null), 1500);
      }
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSavingKey(null);
    }
  }

  async function handleReset(key: string) {
    setSavingKey(key);
    try {
      const res = await fetch('/api/prompt-templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        const refetchRes = await fetch('/api/prompt-templates');
        const data = await refetchRes.json();
        if (data.templates) {
          setTemplates(data.templates);
          const editMap: Record<string, string> = {};
          for (const t of data.templates) {
            editMap[t.key] = t.content;
          }
          setEdits(editMap);
        }
        setFlashKey(key);
        setTimeout(() => setFlashKey(null), 1500);
      }
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setSavingKey(null);
    }
  }

  // ─── Render ────────────────────────────────────────────────

  const filtered = templates.filter(t => t.route === subTab);
  const preamble = preambles[subTab] || null;

  // Group by step
  const step1Templates = filtered.filter(t => t.step === 1);
  const step3Templates = filtered.filter(t => t.step === 3);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="animate-spin mr-3" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
        <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 fade-in">
      {/* Sub-tab selector */}
      <div className="flex gap-2">
        {(['generate', 'remix', 'caption', 'carousel'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
            style={{
              background: subTab === tab ? 'var(--color-bg-tertiary)' : 'transparent',
              color: subTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              border: `1px solid ${subTab === tab ? 'var(--color-accent-green)' : 'var(--color-border)'}`,
              boxShadow: subTab === tab ? '0 0 12px rgba(22, 163, 74, 0.1)' : 'none',
            }}
          >
            {tab === 'generate' ? 'Generate' : tab === 'remix' ? 'Remix' : tab === 'caption' ? 'Captions' : 'Carousel'}
          </button>
        ))}
      </div>

      {/* Carousel tab — simpler layout, no pipeline steps */}
      {subTab === 'carousel' ? (
        <div className="space-y-4">
          <div
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-xs leading-relaxed"
            style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
            </svg>
            <span>Camera angle and framing instructions for each carousel slide. These templates guide Grok when generating angle-specific prompts for multi-image carousel posts.</span>
          </div>
          {step1Templates.map(t => (
            <TemplateCard
              key={t.key}
              template={t}
              editValue={edits[t.key] ?? ''}
              onEdit={(v) => setEdits(prev => ({ ...prev, [t.key]: v }))}
              onSave={() => handleSave(t.key)}
              onReset={() => handleReset(t.key)}
              saving={savingKey === t.key}
              flashing={flashKey === t.key}
            />
          ))}
        </div>
      ) : /* Caption tab — simpler layout, no pipeline steps */
      subTab === 'caption' ? (
        <div className="space-y-4">
          <div
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-xs leading-relaxed"
            style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
            </svg>
            <span>Per-persona voice and style instructions injected into Grok when generating captions. Leave empty to use the default format.</span>
          </div>
          {step1Templates.map(t => (
            <TemplateCard
              key={t.key}
              template={t}
              editValue={edits[t.key] ?? ''}
              onEdit={(v) => setEdits(prev => ({ ...prev, [t.key]: v }))}
              onSave={() => handleSave(t.key)}
              onReset={() => handleReset(t.key)}
              saving={savingKey === t.key}
              flashing={flashKey === t.key}
            />
          ))}
        </div>
      ) : (
        /* Generate / Remix tabs — pipeline step layout */
        <div className="space-y-0">
          {/* ═══ STEP 1 — Vision Analysis ═══ */}
          <StepHeader step={1} label={subTab === 'generate' ? 'Vision Analysis' : 'Hero Image Analysis'} />
          {step1Templates.map(t => (
            <TemplateCard
              key={t.key}
              template={t}
              editValue={edits[t.key] ?? ''}
              onEdit={(v) => setEdits(prev => ({ ...prev, [t.key]: v }))}
              onSave={() => handleSave(t.key)}
              onReset={() => handleReset(t.key)}
              saving={savingKey === t.key}
              flashing={flashKey === t.key}
            />
          ))}

          {/* ═══ Flow connector ═══ */}
          <FlowConnector />

          {/* ═══ STEP 2 — Reference Image Routing (Read-Only) ═══ */}
          {preamble && (
            <>
              <StepHeader step={2} label={preamble.label} isReadOnly />
              <PreambleCard preamble={preamble} />
              <FlowConnector />
            </>
          )}

          {/* ═══ STEP 3 — Quality Keywords ═══ */}
          {step3Templates.length > 0 && (
            <>
              <StepHeader step={3} label="Quality Keywords" />
              <KeywordStep
                templates={step3Templates}
                edits={edits}
                onEdit={(key, value) => setEdits(prev => ({ ...prev, [key]: value }))}
                onSave={handleSave}
                onReset={handleReset}
                savingKey={savingKey}
                flashKey={flashKey}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
