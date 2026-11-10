// lib/models/manifest.ts
// One source of truth for what each image endpoint accepts.
//
// lib/models/<slug>.json holds either a raw fal OpenAPI schema (written by /api/dev/manifest from the
// provider's own openapi.json) or a hand-transcribed manifest for providers without OpenAPI (WaveSpeed).
// normalize() turns both into the same Manifest. The Studio renders its settings chips from
// manifestFor(endpoint).fields, and buildInput() validates a request against the same fields, so the
// UI, the outgoing JSON and the lightbox record cannot drift.
//
// To add a model: fetch its schema (scripts/model-manifest.mjs or the browser route), drop the JSON in
// lib/models/, register it in REGISTRY below, and set EXPOSE entries for any new field you want in the UI.

import zTurboLora from './fal-ai-z-image-turbo-lora.json';
import flux2Lora from './fal-ai-flux-2-lora.json';
import flux2LoraEdit from './fal-ai-flux-2-lora-edit.json';
import kleinT2i from './blackforestlabs-flux-3-klein-base-text-to-image-lora.json';
import kleinEdit from './blackforestlabs-flux-3-klein-base-edit-image-lora.json';
import nano2FalEdit from './fal-ai-nano-banana-2-edit.json';
import nanoProFalEdit from './fal-ai-nano-banana-pro-edit.json';
import seed45FalEdit from './fal-ai-bytedance-seedream-v4-5-edit.json';
import seed40FalEdit from './fal-ai-bytedance-seedream-v4-edit.json';
import zTrainer from './fal-ai-z-image-trainer.json';
import flux2Trainer from './fal-ai-flux-2-trainer-v2.json';
import kleinTrainer from './blackforestlabs-flux-3-klein-base-trainer.json';
import wsZImg2img from './wavespeed-ai-z-image-turbo-image-to-image-lora.json';
import wsNano21 from './google-nano-banana-2-1-edit.json';
import wsWan22 from './wavespeed-ai-wan-2-2-i2v-720p-lora.json';
import wsNano2 from './google-nano-banana-2-edit.json';
import wsNanoPro from './google-nano-banana-pro-edit.json';
import wsSeed50 from './bytedance-seedream-v5-0-lite-edit-sequential.json';
import wsSeed45 from './bytedance-seedream-v4-5-edit-sequential.json';
import wsSeed40 from './bytedance-seedream-v4-edit-sequential.json';

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'any';
export type FieldGroup = 'identity' | 'image' | 'sampler' | 'safety' | 'io' | 'other';

export interface Field {
  name: string;
  type: FieldType;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: string[];
  items?: string;             // item type or sub-schema name for arrays
  ref?: string;               // sub-schema name for objects
  desc: string;
  required: boolean;
  // presentation
  exposed: boolean;           // shown in the Studio
  label: string;
  group: FieldGroup;
  presets?: (number | string)[];   // chip values for numbers (built from min/max/default when absent)
}

export interface Manifest {
  endpoint: string;
  provider: 'fal' | 'wavespeed';
  fetchedAt: string;
  required: string[];
  fields: Record<string, Field>;
  subschemas: Record<string, Record<string, Pick<Field, 'type' | 'default' | 'min' | 'max' | 'enum'>>>;
}

// Which fields the Studio shows, how they are labelled, and sensible chip presets.
// Everything not listed is still in the manifest (and sent at the provider default if needed) but hidden.
// Fields the app fills itself (prompt, loras, image/image_urls/images, seed) are managed, never user chips.
const MANAGED = new Set(['prompt', 'loras', 'image', 'image_urls', 'images', 'seed', 'image_size', 'size', 'image_data_url', 'images_data_url', 'sync_mode', 'enable_sync_mode', 'enable_base64_output', 'trigger_phrase', 'default_caption', 'output_format', 'max_images', 'num_images', 'history', 'context', 'system_prompt', 'return_history', 'include_thoughts', 'pdf_url', 'audio_url', 'video_url']);
const EXPOSE: Record<string, { label: string; group: FieldGroup; presets?: (number | string)[] }> = {
  strength:                { label: 'img2img strength', group: 'image', presets: [0.5, 0.6, 0.7, 0.8, 0.9] },
  num_inference_steps:     { label: 'steps', group: 'sampler' },
  guidance_scale:          { label: 'guidance', group: 'sampler' },
  enable_prompt_expansion: { label: 'enhance prompt', group: 'sampler' },
  acceleration:            { label: 'speed', group: 'sampler' },
  image_size:              { label: 'size', group: 'image' },
  size:                    { label: 'size', group: 'image', presets: ['1024*1024', '1024*1328', '1024*1536', '1328*1024', '1536*1024'] },
  aspect_ratio:            { label: 'ratio', group: 'image' },
  resolution:              { label: 'resolution', group: 'image' },
  num_images:              { label: 'images', group: 'io' },
  output_format:           { label: 'format', group: 'io' },
  enable_safety_checker:   { label: 'safety checker', group: 'safety' },
  enable_web_search:       { label: 'web search', group: 'other' },
  safety_tolerance:        { label: 'safety tolerance', group: 'safety' },
  thinking_level:          { label: 'thinking', group: 'sampler' },
  enhance_prompt_mode:     { label: 'enhance prompt mode', group: 'sampler' },
  enable_image_search:     { label: 'image search', group: 'other' },
  // trainers
  steps:                   { label: 'training steps', group: 'sampler', presets: [600, 1000, 1500, 2000, 2500, 3000] },
  learning_rate:           { label: 'learning rate', group: 'sampler', presets: [0.00005, 0.0001, 0.0002, 0.0004] },
  training_type:           { label: 'training type', group: 'identity' },
  output_lora_format:      { label: 'LoRA format', group: 'io' },
};

interface RawFal { endpoint: string; provider: string; fetched_at: string; schema: { input: string; components: Record<string, { properties?: Record<string, Record<string, unknown>>; required?: string[]; enum?: string[] }> } }
interface RawHand { endpoint: string; provider: string; fetched_at: string; manifest: { required?: string[]; fields: Record<string, Record<string, unknown>>; subschemas?: Record<string, Record<string, Record<string, unknown>>> } }

function numPresets(min?: number, max?: number, def?: unknown, integer = false): (number | string)[] | undefined {
  if (min == null || max == null) return undefined;
  const d = typeof def === 'number' ? def : (min + max) / 2;
  const span = max - min;
  const raw = [min + span * 0.1, min + span * 0.25, d, min + span * 0.6, min + span * 0.8, max];
  const vals = raw.map(v => integer ? Math.round(v) : Number(v.toFixed(2)));
  return Array.from(new Set(vals)).sort((a, b) => a - b);
}

function finish(name: string, f: Omit<Field, 'name' | 'exposed' | 'label' | 'group' | 'presets'>): Field {
  const ex = EXPOSE[name];
  const presets = ex?.presets ?? (f.enum ? undefined : (f.type === 'number' || f.type === 'integer') ? numPresets(f.min, f.max, f.default, f.type === 'integer') : undefined);
  return { name, ...f, exposed: !!ex && !MANAGED.has(name), label: ex?.label || name.replace(/_/g, ' '), group: ex?.group || 'other', presets };
}

function fromFal(raw: RawFal): Manifest {
  const S = raw.schema.components;
  const inp = S[raw.schema.input];
  const fields: Manifest['fields'] = {};
  const subschemas: Manifest['subschemas'] = {};
  const deref = (v: Record<string, unknown>): { ref?: string; enum?: string[] } => {
    const ref = (v.$ref as string) || ((v.allOf as { $ref?: string }[])?.[0]?.$ref);
    if (ref) { const n = ref.split('/').pop()!; return { ref: n, enum: S[n]?.enum }; }
    const any = v.anyOf as Record<string, unknown>[] | undefined;
    if (any) { const e = any.find(a => a.enum); const o = any.find(a => a.$ref); return { enum: e?.enum as string[] | undefined, ref: (o?.$ref as string | undefined)?.split('/').pop() }; }
    return {};
  };
  for (const [k, v] of Object.entries(inp.properties || {})) {
    const d = deref(v);
    const items = v.items as Record<string, unknown> | undefined;
    const t = (v.type as FieldType) || (d.ref ? 'object' : 'any');
    fields[k] = finish(k, {
      type: t, default: v.default, min: v.minimum as number | undefined, max: v.maximum as number | undefined,
      enum: (v.enum as string[] | undefined) || d.enum, ref: d.ref,
      items: items ? (((items.$ref as string | undefined)?.split('/').pop()) || (items.type as string)) : undefined,
      desc: String(v.description || '').slice(0, 200), required: (inp.required || []).includes(k),
    });
  }
  for (const [n, sch] of Object.entries(S)) {
    if (sch.properties && n !== raw.schema.input && !/Output|Status|File$/.test(n)) {
      subschemas[n] = Object.fromEntries(Object.entries(sch.properties).map(([k, v]) => [k, { type: (v.type as FieldType) || 'any', default: v.default, min: v.minimum as number | undefined, max: v.maximum as number | undefined, enum: v.enum as string[] | undefined }]));
    }
  }
  return { endpoint: raw.endpoint, provider: 'fal', fetchedAt: raw.fetched_at, required: inp.required || [], fields, subschemas };
}

function fromHand(raw: RawHand): Manifest {
  const fields: Manifest['fields'] = {};
  for (const [k, v] of Object.entries(raw.manifest.fields)) {
    fields[k] = finish(k, { type: (v.type as FieldType) || 'any', default: v.default, min: v.min as number | undefined, max: v.max as number | undefined, enum: v.enum as string[] | undefined, items: v.items as string | undefined, desc: String(v.desc || ''), required: (raw.manifest.required || []).includes(k) });
  }
  const subschemas: Manifest['subschemas'] = {};
  for (const [n, sch] of Object.entries(raw.manifest.subschemas || {})) subschemas[n] = Object.fromEntries(Object.entries(sch).map(([k, v]) => [k, { type: (v.type as FieldType) || 'any', default: v.default, min: v.min as number | undefined, max: v.max as number | undefined, enum: v.enum as string[] | undefined }]));
  return { endpoint: raw.endpoint, provider: 'wavespeed', fetchedAt: raw.fetched_at, required: raw.manifest.required || [], fields, subschemas };
}

const REGISTRY: Record<string, () => Manifest> = {
  'fal-ai/z-image/turbo/lora': () => fromFal(zTurboLora as unknown as RawFal),
  'fal-ai/flux-2/lora': () => fromFal(flux2Lora as unknown as RawFal),
  'fal-ai/flux-2/lora/edit': () => fromFal(flux2LoraEdit as unknown as RawFal),
  'blackforestlabs/flux-3/klein/base/text-to-image/lora': () => fromFal(kleinT2i as unknown as RawFal),
  'blackforestlabs/flux-3/klein/base/edit-image/lora': () => fromFal(kleinEdit as unknown as RawFal),
  'fal-ai/nano-banana-2/edit': () => fromFal(nano2FalEdit as unknown as RawFal),
  'fal-ai/nano-banana-pro/edit': () => fromFal(nanoProFalEdit as unknown as RawFal),
  'fal-ai/bytedance/seedream/v4.5/edit': () => fromFal(seed45FalEdit as unknown as RawFal),
  'fal-ai/bytedance/seedream/v4/edit': () => fromFal(seed40FalEdit as unknown as RawFal),
  'fal-ai/z-image-trainer': () => fromFal(zTrainer as unknown as RawFal),
  'fal-ai/flux-2-trainer-v2': () => fromFal(flux2Trainer as unknown as RawFal),
  'blackforestlabs/flux-3/klein/base/trainer': () => fromFal(kleinTrainer as unknown as RawFal),
  'wavespeed-ai/z-image-turbo/image-to-image-lora': () => fromHand(wsZImg2img as unknown as RawHand),
  'google/nano-banana-2.1/edit': () => fromHand(wsNano21 as unknown as RawHand),
  'wavespeed-ai/wan-2.2/i2v-720p-lora': () => fromHand(wsWan22 as unknown as RawHand),
  'google/nano-banana-2/edit': () => fromHand(wsNano2 as unknown as RawHand),
  'google/nano-banana-pro/edit': () => fromHand(wsNanoPro as unknown as RawHand),
  'bytedance/seedream-v5.0-lite/edit-sequential': () => fromHand(wsSeed50 as unknown as RawHand),
  'bytedance/seedream-v4.5/edit-sequential': () => fromHand(wsSeed45 as unknown as RawHand),
  'bytedance/seedream-v4/edit-sequential': () => fromHand(wsSeed40 as unknown as RawHand),
};

const cache = new Map<string, Manifest>();
/** Manifest for an endpoint id. Accepts the app's "wavespeed:<id>" prefix. */
export function manifestFor(endpoint: string): Manifest | null {
  const id = endpoint.replace(/^wavespeed:/, '');
  if (cache.has(id)) return cache.get(id)!;
  const f = REGISTRY[id];
  if (!f) return null;
  const m = f();
  cache.set(id, m);
  return m;
}
export function listManifests(): string[] { return Object.keys(REGISTRY); }

/** Fields the Studio shows for an endpoint, in a stable order. */
export function exposedFields(endpoint: string): Field[] {
  const m = manifestFor(endpoint);
  if (!m) return [];
  const order: FieldGroup[] = ['identity', 'image', 'sampler', 'safety', 'io', 'other'];
  return Object.values(m.fields).filter(f => f.exposed).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name));
}

/**
 * Build a provider request from user params + app-managed values, validated against the manifest:
 * unknown fields dropped, numbers clamped, enums checked, booleans coerced. Returns the body and a
 * list of what was dropped or clamped so it can be recorded next to the generation.
 */
export function buildInput(endpoint: string, params: Record<string, unknown>, managed: Record<string, unknown>): { body: Record<string, unknown>; notes: string[] } {
  const m = manifestFor(endpoint);
  const notes: string[] = [];
  const body: Record<string, unknown> = {};
  if (!m) return { body: { ...params, ...managed }, notes: ['no manifest: sent as-is'] };
  for (const [k, v] of Object.entries(params)) {
    const f = m.fields[k];
    if (!f) { notes.push(`dropped ${k} (not in ${m.endpoint})`); continue; }
    if (v == null || v === '') continue;
    if (f.type === 'number' || f.type === 'integer') {
      let n = Number(v);
      if (!Number.isFinite(n)) { notes.push(`dropped ${k}: not a number`); continue; }
      if (f.min != null && n < f.min) { notes.push(`${k} clamped to ${f.min}`); n = f.min; }
      if (f.max != null && n > f.max) { notes.push(`${k} clamped to ${f.max}`); n = f.max; }
      body[k] = f.type === 'integer' ? Math.round(n) : n;
    } else if (f.type === 'boolean') {
      body[k] = v === true || v === 'true';
    } else if (f.enum && typeof v === 'string' && !f.enum.includes(v)) {
      notes.push(`dropped ${k}=${v}: not one of ${f.enum.join('/')}`);
    } else body[k] = v;
  }
  for (const [k, v] of Object.entries(managed)) { if (v !== undefined) body[k] = v; }
  return { body, notes };
}
