import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { supabase } from '@/lib/supabase';
import { uploadFile, deleteFile } from '@/lib/storage';

// ─── Types ──────────────────────────────────────────────

interface PersonaRef {
  id: string;
  ref_type: 'face' | 'body';
  slot: number;
  url: string;
  storage_path: string;
}

interface PersonaRow {
  id: string;
  name: string;
  traits: string | null;
  api_provider: string | null;
  prompt_provider: string | null;
  enable_nsfw: boolean | null;
  num_images: number | null;
  body_traits?: string | null;
  active_character_id?: string | null;
  kling_element_id?: string | null;
  persona_refs: PersonaRef[];
}

// ─── GET: Fetch all personas with their reference images ─

export async function GET() {
  try {
    const { data: rows, error } = await supabase
      .from('personas')
      .select('*, persona_refs(*)')
      .order('name');

    if (error) throw error;

    const personas = (rows as PersonaRow[]).map(row => {
      const faceRefs = (row.persona_refs || [])
        .filter(r => r.ref_type === 'face')
        .sort((a, b) => a.slot - b.slot);
      const bodyRefs = (row.persona_refs || [])
        .filter(r => r.ref_type === 'body')
        .sort((a, b) => a.slot - b.slot);

      return {
        id: row.id,
        name: row.name,
        // URL strings for backward compat (used by Copy, Remix, Home, Publish tabs)
        faceRefs: faceRefs.map(r => r.url),
        bodyRefs: bodyRefs.map(r => r.url),
        // Full details with IDs (used by Settings tab for image replacement)
        faceRefDetails: faceRefs.map(r => ({ url: r.url, id: r.id })),
        bodyRefDetails: bodyRefs.map(r => ({ url: r.url, id: r.id })),
        traits: row.traits || '',
        apiProvider: row.api_provider || '',
        numImages: row.num_images || 4,
        nsfw: row.enable_nsfw || false,
        promptProvider: row.prompt_provider || '',
        bodyTraits: row.body_traits || '',
        activeCharacterId: row.active_character_id || null,
        klingElementId: row.kling_element_id || null,
      };
    });

    return NextResponse.json({ personas });
  } catch (error) {
    console.error('[api/config] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

// ─── PATCH: Update persona configuration ───────────────────

interface ImageReplacement {
  index: number;       // which image slot to replace (0 or 1)
  base64: string;      // base64-encoded image data
  filename?: string;
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      personaId,
      traits,
      bodyTraits,
      promptProvider,
      nsfw,
      replaceFaceRefs,
      replaceBodyRefs,
    } = body as {
      personaId: string;
      traits?: string;
      bodyTraits?: string;
      promptProvider?: string;
      nsfw?: boolean;
      replaceFaceRefs?: ImageReplacement[];
      replaceBodyRefs?: ImageReplacement[];
    };

    if (!personaId) {
      return NextResponse.json({ error: 'personaId is required' }, { status: 400 });
    }

    console.log(`[config] Updating persona ${personaId}...`);

    // Step 1: Update text/boolean fields
    const textFields: Record<string, unknown> = {};
    if (traits !== undefined) textFields.traits = traits;
    if (bodyTraits !== undefined) textFields.body_traits = String(bodyTraits).slice(0, 2000);
    if (promptProvider !== undefined) textFields.prompt_provider = promptProvider;
    if (nsfw !== undefined) textFields.enable_nsfw = nsfw;

    if (Object.keys(textFields).length > 0) {
      const { error } = await supabase
        .from('personas')
        .update(textFields)
        .eq('id', personaId);

      if (error) throw error;
      console.log(`[config] Updated text fields: ${Object.keys(textFields).join(', ')}`);
    }

    // Step 2: Handle image replacements
    const hasImageReplacements =
      (replaceFaceRefs && replaceFaceRefs.length > 0) ||
      (replaceBodyRefs && replaceBodyRefs.length > 0);

    if (hasImageReplacements) {
      // Process face reference replacements
      if (replaceFaceRefs && replaceFaceRefs.length > 0) {
        await replaceAttachments(personaId, 'face', replaceFaceRefs);
      }

      // Process body reference replacements
      if (replaceBodyRefs && replaceBodyRefs.length > 0) {
        await replaceAttachments(personaId, 'body', replaceBodyRefs);
      }
    }

    console.log(`[config] Done updating persona ${personaId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[config] PATCH Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

/**
 * Replace specific reference images for a persona.
 * Uploads new image to Supabase Storage, then upserts the persona_refs row
 * using the UNIQUE(persona_id, ref_type, slot) constraint.
 */
async function replaceAttachments(
  personaId: string,
  refType: 'face' | 'body',
  replacements: ImageReplacement[],
) {
  for (const rep of replacements) {
    const rawBuffer = Buffer.from(rep.base64, 'base64');
    const filename = rep.filename || `ref_${rep.index + 1}.jpg`;
    const storagePath = `${personaId}/${refType}_${rep.index}.jpg`;

    // Query old storage_path so we can delete the old file if it differs
    const { data: existing } = await supabase
      .from('persona_refs')
      .select('storage_path')
      .eq('persona_id', personaId)
      .eq('ref_type', refType)
      .eq('slot', rep.index)
      .single();

    // Compress to JPEG q85 — no dimension changes
    const origSize = rawBuffer.length;
    const buffer = await sharp(rawBuffer).jpeg({ quality: 85 }).toBuffer();

    console.log(`[config] Compressed ${refType}[${rep.index}]: ${(origSize / 1024).toFixed(0)} KB → ${(buffer.length / 1024).toFixed(0)} KB`);

    // Upload to Supabase Storage (upserts by default)
    const publicUrl = await uploadFile('persona-refs', storagePath, buffer);

    console.log(`[config] Uploaded ${refType}[${rep.index}]: url=${publicUrl.slice(0, 60)}...`);

    // Upsert persona_refs row — the UNIQUE constraint on (persona_id, ref_type, slot) handles conflicts
    const { error } = await supabase
      .from('persona_refs')
      .upsert(
        {
          persona_id: personaId,
          ref_type: refType,
          slot: rep.index,
          storage_path: storagePath,
          url: publicUrl,
          filename,
        },
        { onConflict: 'persona_id,ref_type,slot' }
      );

    if (error) {
      throw new Error(`Failed to upsert persona_ref (${refType}[${rep.index}]): ${error.message}`);
    }

    console.log(`[config] Upserted ${refType}[${rep.index}] persona_ref row`);

    // Delete old file from storage if path changed (e.g. .png → .jpg)
    if (existing?.storage_path && existing.storage_path !== storagePath) {
      try {
        await deleteFile('persona-refs', existing.storage_path);
        console.log(`[config] Deleted old file: ${existing.storage_path}`);
      } catch {
        console.warn(`[config] Failed to delete old file: ${existing.storage_path}`);
      }
    }
  }
}
