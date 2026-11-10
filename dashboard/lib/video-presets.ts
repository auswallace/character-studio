// dashboard/lib/video-presets.ts
//
// Client-side helpers for the preset ("Move") + Camera + Lens chips.
// Each model belongs to a prompt FAMILY; presets store one prompt per family.
// Camera and lens phrasing is appended per family so the user never types it.

import { VIDEO_MODELS } from '@/lib/video-providers/types';

export type PromptFamily = 'seedance' | 'kling' | 'google';

export function familyFor(model: string): PromptFamily {
  switch (model) {
    case VIDEO_MODELS.SEEDANCE_1_5:
    case VIDEO_MODELS.SEEDANCE_2_0:
    case VIDEO_MODELS.SEEDANCE_2_5:
      return 'seedance';
    case VIDEO_MODELS.VEO_3_1:
    case VIDEO_MODELS.GEMINI_OMNI_FLASH:
      return 'google';
    default:
      return 'kling';
  }
}

// ─── Camera moves ────────────────────────────────────────

export interface CameraMove { id: string; label: string; phrase: Record<PromptFamily, string> }

export const CAMERA_MOVES: CameraMove[] = [
  { id: 'fixed',      label: 'Fixed',        phrase: { seedance: 'Fixed camera, no movement.', kling: 'Static camera.', google: 'Locked-off camera.' } },
  { id: 'push_in',    label: 'Slow push-in', phrase: { seedance: 'Camera pushes in slowly.', kling: 'Slow dolly in.', google: 'Slow push-in toward the subject.' } },
  { id: 'pull_out',   label: 'Slow pull-out',phrase: { seedance: 'Camera pulls back slowly.', kling: 'Slow dolly out.', google: 'Slow pull-back from the subject.' } },
  { id: 'handheld',   label: 'Handheld',     phrase: { seedance: 'Handheld camera with slight natural shake.', kling: 'Handheld, subtle shake.', google: 'Handheld feel, slight natural movement.' } },
  { id: 'track_back', label: 'Track back',   phrase: { seedance: 'Camera tracks backward at her pace.', kling: 'Camera tracks backward smoothly.', google: 'Camera tracks backward ahead of her.' } },
  { id: 'orbit',      label: 'Orbit',        phrase: { seedance: 'Camera arcs slowly around the subject.', kling: 'Slow orbit around subject.', google: 'Camera makes a slow half orbit around her.' } },
  { id: 'pan',        label: 'Slow pan',     phrase: { seedance: 'Camera pans slowly left to right.', kling: 'Slow pan left to right.', google: 'Gentle pan left to right.' } },
  { id: 'tilt_up',    label: 'Tilt up',      phrase: { seedance: 'Camera tilts up slowly from feet to face.', kling: 'Slow tilt up from feet to face.', google: 'Slow tilt up the body to the face.' } },
];

// ─── Lenses ──────────────────────────────────────────────

export interface LensChoice { id: string; label: string; phrase: Record<PromptFamily, string> }

export const LENSES: LensChoice[] = [
  { id: 'none',  label: 'Lens: auto', phrase: { seedance: '', kling: '', google: '' } },
  { id: '24mm',  label: '24mm wide',  phrase: { seedance: 'Wide 24mm look, slight perspective stretch.', kling: '24mm wide-angle lens.', google: 'Shot on a 24mm wide lens.' } },
  { id: '35mm',  label: '35mm',       phrase: { seedance: 'Natural 35mm look.', kling: '35mm lens, natural perspective.', google: 'Shot on a 35mm lens.' } },
  { id: '50mm',  label: '50mm',       phrase: { seedance: 'Classic 50mm look, mild background blur.', kling: '50mm lens, shallow depth of field.', google: 'Shot on a 50mm lens, shallow depth of field.' } },
  { id: '85mm',  label: '85mm portrait', phrase: { seedance: 'Portrait 85mm look, soft compressed background.', kling: '85mm portrait lens, creamy bokeh.', google: 'Shot on an 85mm portrait lens, soft compressed background.' } },
  { id: 'phone', label: 'Phone',      phrase: { seedance: 'Shot on a phone camera, everything in focus.', kling: 'Smartphone camera look, deep focus.', google: 'Phone camera look, deep focus, slight digital sharpness.' } },
];

// ─── Assembly ────────────────────────────────────────────

export interface AssembleOptions {
  presetPrompt?: string;     // family-specific preset text (may contain {subject} / {line})
  subject?: string;          // persona description; default "the woman"
  line?: string;             // dialogue for talk presets
  camera?: string;           // CAMERA_MOVES id
  lens?: string;             // LENSES id
  family: PromptFamily;
}

/** Build the prompt-box text from a preset + chips. Returns '' when there is no preset. */
export function assemblePrompt(o: AssembleOptions): string {
  if (!o.presetPrompt) return '';
  let text = o.presetPrompt
    .replace(/\{subject\}/g, o.subject?.trim() || 'the woman')
    .replace(/\{line\}/g, o.line?.trim() || 'this is the one I actually use');

  const cam = CAMERA_MOVES.find(c => c.id === o.camera);
  if (cam) {
    // Presets already carry a default camera sentence; swap it rather than stack two.
    text = text.replace(/\b(Fixed camera[^.]*\.|Static camera\.|Locked-off camera\.)\s*/g, '');
    text = text.replace(/\bAmbient:/, `${cam.phrase[o.family]} Ambient:`);
    if (!text.includes(cam.phrase[o.family])) text = `${text} ${cam.phrase[o.family]}`;
  }
  const lens = LENSES.find(l => l.id === o.lens);
  if (lens && lens.phrase[o.family]) text = `${text} ${lens.phrase[o.family]}`;

  return text.replace(/\s{2,}/g, ' ').trim();
}

// ─── Wan 2.2 realism recipe ──────────────────────────────
// Wan 2.2 out of the box: clean motion, plastic skin. Wrapping the motion sentence in phone-footage wording
// plus this negative prompt fixed it (video_video_0018, 2026-11-09, judged "ridiculously good" against
// video_video_0017 with the same still and motion). The tested prompt also named the scene ("real daylight",
// "crowd moving in the background"); those two phrases are generalized here so the recipe fits any still.
export const WAN_REALISM = {
  before: 'Handheld iPhone footage, candid and unposed.',
  after: 'Natural skin texture with visible pores, natural light, slight motion blur, subtle camera shake, the background moves naturally.',
  negative: 'smooth skin, plastic skin, airbrushed, CGI, 3d render, cartoon, oversaturated, waxy, doll-like, slow motion, static background, morphing, distorted face',
};
export function wanRealismPrompt(motion: string): string {
  return `${WAN_REALISM.before} ${motion.trim().replace(/\s*$/, '')}${/[.!?]$/.test(motion.trim()) ? '' : '.'} ${WAN_REALISM.after}`;
}

// ─── Dry phone-mic voice (models with native audio) ──────
// Veo's voices tend to sound like a room mic: slight echo and reverb, too clean. Asking for the phone's own
// mic and banning echo in the negative prompt targets exactly that. Added by the Realism chip when audio is on.
export const DRY_VOICE = {
  line: 'Audio: recorded on the phone\'s built-in microphone, dry close-up voice, no echo, no reverb, natural small-room sound.',
  negative: 'echo, reverb, room reverb, studio voice, voice-over, muffled audio, robotic voice',
};

/** Realism wrapper for any model. With audio on, adds the dry-voice line and the anti-echo negatives. */
export function realismPrompt(text: string, withAudio: boolean): { prompt: string; negative: string } {
  const base = wanRealismPrompt(text);
  return {
    prompt: withAudio ? `${base} ${DRY_VOICE.line}` : base,
    negative: withAudio ? `${WAN_REALISM.negative}, ${DRY_VOICE.negative}` : WAN_REALISM.negative,
  };
}

// Wan 2.2 Animate ("Copy a video"): sent when the prompt box is empty. Same recipe as WAN_REALISM, but it asks for
// a sharp face and leaves out "slight motion blur": the motion video already brings its own blur, and soft faces
// were the first complaint (2026-11-10). The endpoint has no negative prompt field.
export const ANIMATE_SHARP = 'Handheld iPhone footage, candid and unposed. Her face is in sharp focus in every frame, crisp eyes, natural skin texture with visible pores, fine hair detail, natural light. The clothes and the background stay the same as in the image.';
