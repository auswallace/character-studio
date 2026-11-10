// Dataset builder catalog: 40 slots that together cover what a character LoRA needs.
// Each slot fixes framing + angle + light + a setting cue. Outfit and expression are left
// to the generator so the set varies. Keys are stable: a dataset image's `slot` column points here.

export type SlotView = 'face' | 'half' | 'full';
export interface Slot { key: string; view: SlotView; angle: 'front' | 'three_quarter' | 'profile' | 'back'; prompt: string }

const face = (n: number, angle: Slot['angle'], p: string): Slot => ({ key: `face_${n}`, view: 'face', angle, prompt: `close-up portrait, head and shoulders, ${p}` });
const half = (n: number, angle: Slot['angle'], p: string): Slot => ({ key: `half_${n}`, view: 'half', angle, prompt: `waist-up shot, ${p}` });
const full = (n: number, angle: Slot['angle'], p: string): Slot => ({ key: `full_${n}`, view: 'full', angle, prompt: `full body, head to feet in frame, ${p}` });

export const CATALOG: Slot[] = [
  // 12 face
  face(1, 'front', 'looking straight at camera, neutral expression, soft window light, plain wall'),
  face(2, 'front', 'smiling, overcast daylight, outdoors, blurred street behind'),
  face(3, 'three_quarter', 'turned slightly left, warm lamp light at night, indoor'),
  face(4, 'three_quarter', 'turned slightly right, golden hour sun from the side, outdoors'),
  face(5, 'profile', 'side profile facing left, studio light, dark background'),
  face(6, 'profile', 'side profile facing right, bright daylight, white background'),
  face(7, 'front', 'laughing, flash photo at night, slightly overexposed'),
  face(8, 'three_quarter', 'serious expression, cool blue light from a screen, dim room'),
  face(9, 'front', 'hair tied back, bathroom mirror selfie, ring light'),
  face(10, 'three_quarter', 'looking down and away, dappled light through leaves'),
  face(11, 'front', 'from slightly above, lying on a bed, soft morning light'),
  face(12, 'three_quarter', 'from slightly below, city lights bokeh behind, evening'),
  // 15 half
  half(1, 'front', 'standing in a bright kitchen, arms relaxed, natural light'),
  half(2, 'front', 'sitting at a cafe table by the window, coffee cup, overcast'),
  half(3, 'three_quarter', 'leaning on a balcony rail, sunset behind'),
  half(4, 'three_quarter', 'in a car passenger seat, daylight through the window'),
  half(5, 'profile', 'side view at a kitchen counter, cooking, bright'),
  half(6, 'front', 'gym, phone in hand, fluorescent light'),
  half(7, 'front', 'bedroom, sitting on the bed edge, warm lamp'),
  half(8, 'three_quarter', 'walking on a city sidewalk, candid, afternoon'),
  half(9, 'back', 'from behind, looking back over the shoulder, beach'),
  half(10, 'front', 'office desk, laptop open, neutral daylight'),
  half(11, 'three_quarter', 'restaurant table at night, candle light'),
  half(12, 'front', 'winter coat and scarf, snowy street, grey sky'),
  half(13, 'three_quarter', 'holding a shopping bag, mall interior, mixed light'),
  half(14, 'front', 'hotel room mirror selfie, phone visible, bright'),
  half(15, 'profile', 'side view on a park bench, reading, dappled light'),
  // 13 full
  full(1, 'front', 'standing on a city sidewalk, afternoon sun, casual outfit'),
  full(2, 'front', 'full-length mirror selfie, bedroom, phone at chest'),
  full(3, 'three_quarter', 'walking through a park, summer, dappled light'),
  full(4, 'three_quarter', 'leaning against a wall, street at night, neon'),
  full(5, 'profile', 'side view walking on a beach, sunset'),
  full(6, 'back', 'from behind, walking away down a hallway, soft light'),
  full(7, 'front', 'sitting on a couch, legs crossed, living room, daylight'),
  full(8, 'front', 'standing at a gym mirror, workout outfit, fluorescent light'),
  full(9, 'three_quarter', 'stretching on a yoga mat, living room, morning'),
  full(10, 'front', 'standing in a doorway, backlit, silhouette edge light'),
  full(11, 'three_quarter', 'sitting on stairs outside, overcast'),
  full(12, 'front', 'winter outfit, snowy street, wide shot'),
  full(13, 'three_quarter', 'crouching to tie a shoe, sidewalk, candid'),
];

export const SLOT_BY_KEY = new Map(CATALOG.map(s => [s.key, s]));
export const SLOT_TARGETS = { face: 12, half: 15, full: 13 } as const;
