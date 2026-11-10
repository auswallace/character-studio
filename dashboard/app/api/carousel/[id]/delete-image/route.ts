import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { deleteFile, deleteFiles } from '@/lib/storage';

interface CarouselImage {
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

    // Get current images for this carousel
    const { data: images, error: fetchError } = await supabase
      .from('carousel_images')
      .select('id, storage_path, url, sort_order')
      .eq('carousel_id', id)
      .order('sort_order');

    if (fetchError) throw fetchError;

    const currentImages = (images || []) as CarouselImage[];

    if (deleteAll) {
      // Delete all images from storage + image rows, but keep the carousel record for analytics
      console.log(`[carousel/delete-image] Deleting all images from ${id} (${currentImages.length} images), keeping record`);

      const storagePaths = currentImages
        .map(img => img.storage_path)
        .filter((p): p is string => p !== null);

      if (storagePaths.length > 0) {
        await deleteFiles('carousel-images', storagePaths);
      }

      // Also delete the hero image from storage if it exists
      try {
        await deleteFile('carousel-images', `${id}/hero.jpg`);
      } catch {
        // Hero may not exist in storage (could be an external URL) — ignore
      }

      // Delete all image rows
      const { error: deleteImagesError } = await supabase
        .from('carousel_images')
        .delete()
        .eq('carousel_id', id);

      if (deleteImagesError) throw deleteImagesError;

      // Flag the carousel record as having all images deleted (preserve for analytics)
      await supabase.from('carousels').update({ all_images_deleted: true }).eq('id', id);

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
          { error: 'Image not found in this carousel' },
          { status: 404 }
        );
      }

      console.log(`[carousel/delete-image] Deleting 1 image from ${id}, ${currentImages.length - 1} remaining`);

      // Delete from Storage if there's a storage path
      if (targetImage.storage_path) {
        await deleteFile('carousel-images', targetImage.storage_path);
      }

      // Delete the image row
      const { error: deleteRowError } = await supabase
        .from('carousel_images')
        .delete()
        .eq('id', targetImage.id);

      if (deleteRowError) throw deleteRowError;

      const remaining = currentImages.length - 1;

      // If no images remain, flag the carousel (preserve record for analytics)
      if (remaining === 0) {
        console.log(`[carousel/delete-image] No images remaining, flagging carousel ${id}`);

        // Clean up hero image from storage
        try {
          await deleteFile('carousel-images', `${id}/hero.jpg`);
        } catch {
          // Hero may not exist in storage — ignore
        }

        await supabase.from('carousels').update({ all_images_deleted: true }).eq('id', id);

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
    console.error(`[carousel/delete-image] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
