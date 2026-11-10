-- Video prompt presets ("Moves"): named motion blueprints that expand into a
-- model-family-specific prompt. Modeled on Higgsfield's preset-first UI.
-- family keys in `prompts`: seedance | kling | google (Veo / Gemini Omni)
-- Applied to the hosted project 2026-11-04.

CREATE TABLE IF NOT EXISTS video_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,              -- 'mirror' | 'product' | 'talk' | 'move' | 'reveal' | 'user'
  description TEXT,
  prompts JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "seedance": "...", "kling": "...", "google": "..." }
  default_camera TEXT,                 -- key in the Camera chip list, optional
  source TEXT NOT NULL DEFAULT 'builtin',      -- 'builtin' | 'user'
  source_video_id UUID,                -- video_generations.id when promoted from a clip
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE video_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON video_presets;
CREATE POLICY "anon_all" ON video_presets FOR ALL TO anon USING (true) WITH CHECK (true);
-- NOTE: same single-user anon policy as every other table. Tightened in the auth work (launch-readiness Tier 1).

-- ─── Builtin presets ─────────────────────────────────────
-- {subject} is replaced client-side with the persona description (or "the woman").

INSERT INTO video_presets (name, category, description, prompts, default_camera, sort_order) VALUES
('Mirror check, subtle', 'mirror', 'Phone-in-hand mirror selfie, small weight shifts, glances at herself',
 '{"seedance": "{subject} stands in front of the mirror holding her phone up. She shifts her weight to one hip, glances down at her outfit, adjusts the hem with her free hand, then looks back at her reflection with a small satisfied nod. Phone stays steady. Small natural movements, nothing exaggerated. Fixed camera. Ambient: quiet room hum, fabric rustle.",
   "kling": "Medium shot, mirror selfie: {subject} holds her phone to the mirror, shifts weight to one hip, glances down at her outfit, adjusts the hem, looks back at her reflection and nods slightly. Phone steady. Subtle realistic motion, static camera, flat indoor lighting, photoreal.",
   "google": "Mirror selfie. {subject} holds her phone steady toward the mirror, shifts her weight to one hip, looks down at her outfit and tugs the hem straight, then meets her own eyes in the reflection with a small nod. Static camera, flat indoor light, natural skin texture. Ambient: faint room tone, cloth rustle."}',
 'fixed', 10),

('Mirror turn, side to front', 'mirror', 'Starts side-on, turns to face the mirror (use start + end frames)',
 '{"seedance": "{subject} stands side-on to the mirror holding her phone up. She turns slowly to face the mirror, settles her feet, and relaxes into a front pose, phone held steady the whole time. One smooth turn, no extra gestures. Fixed camera. Ambient: quiet room, soft footstep on the mat.",
   "kling": "Medium shot, mirror selfie: {subject} begins side-on and turns slowly to face the mirror, settling into a relaxed front pose, phone held steady. Single smooth rotation, static camera, flat indoor lighting, photoreal.",
   "google": "Mirror selfie. {subject} starts in profile, phone raised, and turns in one unhurried motion to face the mirror, settling her stance. Phone steady. Static camera, even indoor light. Ambient: quiet room, a soft footstep."}',
 'fixed', 11),

('Hair fix and smile', 'mirror', 'Tucks hair, checks angle, quick smile',
 '{"seedance": "{subject} holds her phone to the mirror. She tucks a strand of hair behind her ear, tilts her head slightly to check the angle, and gives a quick half-smile before going back to a neutral face. Phone steady. Fixed camera. Ambient: soft room tone.",
   "kling": "Medium shot, mirror selfie: {subject} tucks hair behind her ear, tilts her head to check her angle, flashes a quick half-smile then relaxes. Phone steady, static camera, soft indoor light, photoreal.",
   "google": "Mirror selfie. {subject} tucks a strand of hair behind her ear, tilts her head a few degrees to check the angle, and lets a quick half-smile through before her face settles. Static camera, soft light. Ambient: room tone."}',
 'fixed', 12),

('Product hold-up', 'product', 'Lifts the product toward camera, label forward',
 '{"seedance": "{subject} lifts the product into frame at chest height, turns it so the label faces the camera, and holds it still for a beat while looking at the lens. Small confident movement. Slow push-in. Ambient: quiet interior.",
   "kling": "Medium close-up: {subject} raises the product to chest height, rotates it label-forward to the camera, holds it steady and looks into the lens. Slow push-in, soft key light, product sharp and legible, photoreal.",
   "google": "Medium close-up. {subject} brings the product up to chest height, rotates it so the label faces the lens, and holds it still while meeting the camera. Slow push-in, soft key light, label crisp. Ambient: quiet interior."}',
 'push_in', 20),

('Product demo, hands', 'product', 'Opens or uses the product, close on hands',
 '{"seedance": "Close on {subject}''s hands as she opens the product and uses it once, then tilts it toward the camera. Deliberate, unhurried hands. Fixed camera, shallow depth of field. Ambient: small product sounds, quiet room.",
   "kling": "Close-up on hands: {subject} opens the product, uses it once, and tilts it toward the camera. Deliberate motion, fixed camera, shallow depth of field, soft light, photoreal.",
   "google": "Close-up on hands. {subject} opens the product, uses it once, and angles it to the lens. Slow, deliberate. Fixed camera, shallow depth of field, soft directional light. Ambient: the product''s own small sounds, quiet room."}',
 'fixed', 21),

('Talk to camera, casual', 'talk', 'Spokesperson line to the lens, relaxed (add dialogue in quotes)',
 '{"seedance": "{subject} looks into the camera and says \"{line}\" with a relaxed, friendly tone, a small hand gesture on the key word, then a slight smile. Fixed camera, eye-level. Ambient: quiet room tone.",
   "kling": "Medium shot, eye-level: {subject} speaks to camera, says \"{line}\", relaxed tone, one small hand gesture, slight smile at the end. Static camera, soft light, natural lip sync, photoreal.",
   "google": "Medium shot, eye level. {subject} looks into the lens and says \"{line}\" in a warm, unhurried voice, one small gesture on the key word, a slight smile after. Static camera, soft light. Ambient: quiet room."}',
 'fixed', 30),

('Talk to camera, walking', 'talk', 'Delivers a line while walking toward camera (add dialogue in quotes)',
 '{"seedance": "{subject} walks slowly toward the camera and says \"{line}\" while walking, natural stride, looking at the lens. Camera tracks backward at her pace. Ambient: footsteps, light room or street tone.",
   "kling": "Medium shot: {subject} walks toward camera, says \"{line}\" mid-stride, eyes on lens. Camera tracks backward smoothly, natural lighting, natural lip sync, photoreal.",
   "google": "Medium shot. {subject} walks toward the camera at an easy pace and says \"{line}\", eyes on the lens. Camera tracks backward with her. Natural light. Ambient: footsteps, light background tone."}',
 'track_back', 31),

('Turn to camera', 'move', 'Facing away, turns to look at the lens',
 '{"seedance": "{subject} stands facing away from the camera, then turns her head and shoulders to look over her shoulder at the lens, holding the look for a beat. Slow, controlled. Fixed camera. Ambient: quiet.",
   "kling": "Medium shot from behind: {subject} turns head and shoulders to look over her shoulder at the camera and holds. Slow controlled motion, static camera, soft light, photoreal.",
   "google": "Medium shot from behind. {subject} turns her head and shoulders to look back over her shoulder at the lens and holds it. Slow, controlled. Static camera, soft light. Ambient: quiet."}',
 'fixed', 40),

('Walk-in and stop', 'move', 'Enters frame, stops, settles into a pose',
 '{"seedance": "{subject} walks into frame from the side, stops at center, settles her weight and relaxes into a natural standing pose facing the camera. Fixed camera. Ambient: footsteps, room tone.",
   "kling": "Wide shot: {subject} enters from frame left, stops center, settles into a relaxed standing pose facing camera. Static camera, even lighting, photoreal.",
   "google": "Wide shot. {subject} walks in from the side, stops at center frame, and settles into an easy standing pose facing the lens. Static camera, even light. Ambient: footsteps, room tone."}',
 'fixed', 41),

('Sit down and settle', 'move', 'Sits onto a chair or couch, gets comfortable',
 '{"seedance": "{subject} sits down onto the seat, settles back, crosses one leg, and looks toward the camera. Natural pace. Fixed camera. Ambient: cushion compress, quiet room.",
   "kling": "Medium shot: {subject} sits down, settles back, crosses one leg, looks to camera. Natural pacing, static camera, soft interior light, photoreal.",
   "google": "Medium shot. {subject} sits down, leans back into the seat, crosses one leg and looks toward the lens. Natural pacing. Static camera, soft interior light. Ambient: cushion, quiet room."}',
 'fixed', 42),

('Slow orbit', 'move', 'Camera circles the subject, she stays mostly still',
 '{"seedance": "{subject} stands still with a relaxed posture, breathing naturally, eyes following the camera. The camera arcs slowly around her, a half circle. Ambient: quiet interior.",
   "kling": "Medium shot: {subject} stands relaxed, eyes tracking the lens, as the camera arcs slowly around her in a half circle. Smooth orbit, soft light, photoreal.",
   "google": "Medium shot. {subject} holds a relaxed stance, breathing naturally, eyes following the lens as the camera makes a slow half orbit around her. Soft light. Ambient: quiet interior."}',
 'orbit', 43),

('Hair flip reveal', 'reveal', 'Head down, flips hair back, looks up',
 '{"seedance": "{subject} starts with her head tilted down, flips her hair back with one motion, and looks up into the camera with a small smile. One clean movement. Fixed camera. Ambient: quiet, a soft whoosh of hair.",
   "kling": "Medium close-up: {subject} starts head-down, flips her hair back in one motion, looks up at camera with a small smile. Static camera, soft light, natural hair physics, photoreal.",
   "google": "Medium close-up. {subject} begins with her head down, sweeps her hair back in one motion, and looks up into the lens with a small smile. Static camera, soft light. Ambient: quiet, the soft whoosh of hair."}',
 'fixed', 50),

('Step back, full body', 'reveal', 'Starts close, steps back to show the full outfit',
 '{"seedance": "{subject} starts close to the camera, then takes two steps back to show her full outfit, stops, and does a small half-turn to each side. Fixed camera. Ambient: footsteps, room tone.",
   "kling": "Starts medium close-up: {subject} steps back twice into a full-body frame, stops, half-turns left then right to show the outfit. Static camera, even lighting, photoreal.",
   "google": "Begins in medium close-up. {subject} steps back twice to reveal her full outfit, stops, and does a small half turn to each side. Static camera, even light. Ambient: footsteps, room tone."}',
 'fixed', 51),

('Laugh and look away', 'reveal', 'Candid laugh, looks off camera, back to lens',
 '{"seedance": "{subject} laughs naturally at something off camera, looks away to the side, then brings her eyes back to the lens still smiling. Fixed camera. Ambient: her soft laugh, quiet room.",
   "kling": "Medium close-up: {subject} laughs naturally, glances off camera, returns her eyes to the lens still smiling. Static camera, soft light, photoreal.",
   "google": "Medium close-up. {subject} laughs at something off camera, looks to the side, then returns to the lens with the smile still there. Static camera, soft light. Ambient: her soft laugh, quiet room."}',
 'fixed', 52),

('Breathing portrait', 'reveal', 'Almost still: breathing, blink, micro expression',
 '{"seedance": "{subject} holds a still portrait pose, breathing softly, blinks once, and lets a very slight expression change cross her face. Almost no movement. Fixed camera, shallow depth of field. Ambient: near silence.",
   "kling": "Close-up portrait: {subject} nearly still, soft breathing, one blink, a subtle shift in expression. Static camera, shallow depth of field, soft light, photoreal.",
   "google": "Close-up portrait. {subject} is almost still: soft breathing, one blink, a subtle change in expression. Static camera, shallow depth of field, soft light. Ambient: near silence."}',
 'fixed', 53);
