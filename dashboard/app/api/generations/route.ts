import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ─── Helpers ────────────────────────────────────────────

/** Build Next.js image optimization thumbnails for a Supabase Storage URL */
function makeThumbnails(url: string) {
  if (!url) return null;
  const enc = encodeURIComponent(url);
  return {
    small: { url: `/_next/image?url=${enc}&w=64&q=70` },
    large: { url: `/_next/image?url=${enc}&w=640&q=75` },
    full: { url: `/_next/image?url=${enc}&w=1920&q=85` },
  };
}

// ─── Types ──────────────────────────────────────────────

interface GenerationImage {
  id: string;
  url: string;
  filename: string | null;
  width: number | null;
  height: number | null;
  is_upscaled: boolean | null;
  sort_order: number | null;
}

interface GenerationRow {
  id: string;
  name: string | null;
  prompt: string | null;
  prompt_note: string | null;
  prompt_image_url: string | null;
  persona: string | null;
  image_model: string | null;
  error_message: string | null;
  starred: boolean | null;
  provider: string | null;
  provider_input?: Record<string, unknown> | null;
  created_at: string;
  generation_images: GenerationImage[];
}

// ─── GET: List generations with their images ────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const persona = searchParams.get('persona');
    const ids = searchParams.get('ids');

    let query = supabase
      .from('generations')
      .select('*, generation_images(*)')
      .or('all_images_deleted.is.null,all_images_deleted.eq.false')
      .order('created_at', { ascending: false });

    // Recovery mode: fetch specific records by ID
    if (ids) {
      const idList = ids.split(',').filter(Boolean);
      query = query.in('id', idList);
    } else {
      if (persona) {
        query = query.eq('persona', persona);
      }
      query = query.range(offset, offset + limit - 1);
    }

    const { data: rows, error } = await query;

    if (error) throw error;

    const generations = (rows as GenerationRow[]).map(row => {
      const allImages = (row.generation_images || [])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      const regularImages = allImages.filter(img => !img.is_upscaled);
      const upscaledImages = allImages.filter(img => img.is_upscaled);

      return {
        id: row.id,
        name: row.name || '',
        prompt: row.prompt || '',
        persona: row.persona || '',
        imageModel: row.image_model || '',
        images: regularImages.map(img => ({
          url: img.url,
          filename: img.filename,
          width: img.width,
          height: img.height,
          thumbnails: makeThumbnails(img.url),
        })),
        upscaledImages: upscaledImages.map(img => ({
          url: img.url,
          filename: img.filename,
          width: img.width,
          height: img.height,
          thumbnails: makeThumbnails(img.url),
        })),
        promptImage: row.prompt_image_url || null,
        error: row.error_message || null,
        status: regularImages.length > 0
          ? 'done'
          : row.error_message
            ? 'error'
            : 'pending',
        starred: row.starred || false,
        provider: row.provider || null,
        providerInput: row.provider_input || null,
        createdAt: row.created_at,
      };
    });

    return NextResponse.json({ generations });
  } catch (error) {
    console.error('[api/generations] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch generations' },
      { status: 500 }
    );
  }
}

// ─── POST: Create a new generation record ───────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, promptNote, persona, promptImageUrl } = body;

    if (!persona) {
      return NextResponse.json({ error: 'persona is required' }, { status: 400 });
    }

    const insertFields: Record<string, unknown> = {
      persona,
    };

    if (prompt) insertFields.prompt = prompt;
    if (promptNote) insertFields.prompt_note = promptNote;
    if (promptImageUrl) insertFields.prompt_image_url = promptImageUrl;

    const { data: record, error } = await supabase
      .from('generations')
      .insert(insertFields)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      id: record.id,
      name: record.name || '',
      status: 'pending',
      message: 'Generation queued. Run batch-processor to generate images.',
    });
  } catch (error) {
    console.error('[api/generations] POST Error:', error);
    return NextResponse.json(
      { error: 'Failed to create generation' },
      { status: 500 }
    );
  }
}
