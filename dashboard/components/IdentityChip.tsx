'use client';

// Where the face comes from when the persona has a trained character.
//   lora   -> the LoRA renders the whole image (fal / WaveSpeed LoRA endpoints)
//   hybrid -> the chosen image model (Nano Banana, Seedream) does the scene; her best LoRA stills are the identity references
//   refs   -> the original reference photos (no trained character)
// Sent to the routes as { useCharacter, sceneEngine }.

export type IdentityMode = 'lora' | 'hybrid' | 'refs';
const ORDER: IdentityMode[] = ['lora', 'hybrid', 'refs'];
const LABEL: Record<IdentityMode, string> = { lora: 'LoRA renders', hybrid: 'Model + LoRA stills', refs: 'Reference photos' };
const TITLE: Record<IdentityMode, string> = {
  lora: 'The trained character (LoRA) renders the image. The image model chips are bypassed.',
  hybrid: 'The image model does the scene; her 3 best-scoring LoRA stills go in as the identity references instead of the reference photos.',
  refs: 'Original reference photos, no trained character.',
};

export function identityBody(mode: IdentityMode): { useCharacter: boolean; sceneEngine: 'lora' | 'nano' } {
  return { useCharacter: mode !== 'refs', sceneEngine: mode === 'hybrid' ? 'nano' : 'lora' };
}

// `modes` limits the cycle. Image Copy offers the LoRA as its own entry in the model menu, so its chip only
// switches between the image model's two reference sources: ['hybrid', 'refs'].
export default function IdentityChip({ value, onChange, modelLabel, modes = ORDER }: { value: IdentityMode; onChange: (m: IdentityMode) => void; modelLabel?: string; modes?: IdentityMode[] }) {
  const on = value !== 'refs';
  const col = value === 'lora' ? '#16A34A' : value === 'hybrid' ? '#2563EB' : '#bbb';
  const text = value === 'hybrid' ? (modes === ORDER && modelLabel ? `${modelLabel} + LoRA stills` : 'Her LoRA stills as references') : LABEL[value];
  return (
    <button type="button" onClick={() => onChange(modes[(modes.indexOf(value) + 1) % modes.length])} title={TITLE[value] + ' Click to cycle.'}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, border: '1px solid', borderColor: on ? col : 'var(--color-border)', background: on ? (value === 'lora' ? 'rgba(22,163,74,0.08)' : 'rgba(37,99,235,0.08)') : 'transparent', color: on ? (value === 'lora' ? '#065F46' : '#1E40AF') : 'var(--color-text-tertiary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: col }} />
      {text}
    </button>
  );
}
