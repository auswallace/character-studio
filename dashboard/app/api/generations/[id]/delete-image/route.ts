import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { deleteFile, deleteFiles } from '@/lib/storage';

interface GenerationImage {
  id: string;
  storage_path: string | null;
  url: string;
  sort_order: number | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { imageUrl, deleteAll } = body as { imageUrl?: string; deleteAll?: boolean };

    if (!deleteAll && !imageUrl) {
      return NextResponse.json(
        { error: 'Must provide imageUrl or deleteAll: true' },
        { status: 400 }
      );
    }

    // Get current images for this generation
    const { data: images, error: fetchError } = await supabase
      .from('generation_images')
      .select('id, storage_path, url, sort_order')
      .eq('generation_id', id)
      .order('sort_order');

    if (fetchError) throw fetchError;

    const currentImages = (images || []) as GenerationImage[];

    if (deleteAll) {
      // Delete all images from storage + image rows, but keep the generation record for analytics
      console.log(`[delete-image] Deleting all images from ${id} (${currentImages.length} images), keeping record`);

      const storagePaths = currentImages
        .map(img => img.storage_path)
        .filter((p): p is string => p !== null);

      if (storagePaths.length > 0) {
        await deleteFiles('generated-images', storagePaths);
      }

      // Delete all image rows
      const { error: deleteImagesError } = await supabase
        .from('generation_images')
        .delete()
        .eq('generation_id', id);

      if (deleteImagesError) throw deleteImagesError;

      // Flag the generation record as having all images deleted (preserve for analytics)
      await supabase.from('generations').update({ all_images_deleted: true }).eq('id', id);

      return NextResponse.json({
        success: true,
        deleted: false,
        allImagesDeleted: true,
        remaining: 0,
      });
    } else {
      // Delete a single image by URL match
      const targetImage = currentImages.find(img => img.url === imageUrl);

      if (!targetImage) {
        return NextResponse.json(
          { error: 'Image not found in this generation' },
          { status: 404 }
        );
      }

      console.log(`[delete-image] Deleting 1 image from ${id}, ${currentImages.length - 1} remaining`);

      // Delete from Storage if there's a storage path
      if (targetImage.storage_path) {
        await deleteFile('generated-images', targetImage.storage_path);
      }

      // Delete the image row
      const { error: deleteRowError } = await supabase
        .from('generation_images')
        .delete()
        .eq('id', targetImage.id);

      if (deleteRowError) throw deleteRowError;

      const remaining = currentImages.length - 1;

      // If no images remain, flag the generation (preserve record for analytics)
      if (remaining === 0) {
        console.log(`[delete-image] No images remaining, flagging generation ${id}`);
        await supabase.from('generations').update({ all_images_deleted: true }).eq('id', id);

        return NextResponse.json({
          success: true,
          deleted: false,
          allImagesDeleted: true,
          remaining: 0,
        });
      }

      return NextResponse.json({
        success: true,
        remaining,
      });
    }
  } catch (err) {
    console.error(`[delete-image] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
