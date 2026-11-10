import { NextRequest, NextResponse } from 'next/server';
import { uploadFile } from '@/lib/storage';

// ─── POST — Upload source image/video for video generation ──
//
// Accepts multipart FormData with a single file.
// Uploads to video-pipeline bucket and returns the public URL.
// This runs server-side so the anon key stays private.

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null; // 'source' | 'end' | 'reference'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');   // voice tracks for /api/ads/lipsync
    if (!isImage && !isVideo && !isAudio) {
      return NextResponse.json({ error: 'File must be an image, video or audio file' }, { status: 400 });
    }

    // Size limits: 10MB for images, 50MB for videos
    const maxSize = isVideo ? 50 * 1024 * 1024 : isAudio ? 5 * 1024 * 1024 : 10 * 1024 * 1024;   // audio: lipsync limit is 5 MB
    if (file.size > maxSize) {
      return NextResponse.json({
        error: `File too large. Max ${isVideo ? '50MB' : '10MB'} for ${isVideo ? 'videos' : 'images'}.`,
      }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate a unique path
    const id = crypto.randomUUID();
    const ext = isVideo ? 'mp4' : isAudio ? (file.type.includes('wav') ? 'wav' : 'mp3') : 'jpg';
    const label = type || 'file';
    const storagePath = `uploads/${id}/${label}.${ext}`;

    const publicUrl = await uploadFile('video-pipeline', storagePath, buffer, file.type);

    console.log(`[video/upload] Uploaded ${label} (${(file.size / 1024).toFixed(0)} KB) → ${storagePath}`);

    return NextResponse.json({
      url: publicUrl,
      storagePath,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[video/upload] Error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
