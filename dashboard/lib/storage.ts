import { supabase, SUPABASE_URL } from './supabase';

// ─── Supabase Storage Helpers ────────────────────────────
// Upload, download, delete files from Supabase Storage buckets.
// All buckets are assumed to be public (public URL construction).

/**
 * Upload a file (Buffer) to Supabase Storage.
 * Uses upsert to allow overwriting existing files at the same path.
 * Returns the permanent public URL for the uploaded file.
 */
export async function uploadFile(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string = 'image/jpeg',
): Promise<string> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed [${bucket}/${path}]: ${error.message}`);
  }

  return getPublicUrl(bucket, path);
}

/**
 * Construct the permanent public URL for a file in a public bucket.
 * No API call needed — just URL construction.
 */
export function getPublicUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Delete a single file from a bucket.
 */
export async function deleteFile(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([path]);

  if (error) {
    throw new Error(`Storage delete failed [${bucket}/${path}]: ${error.message}`);
  }
}

/**
 * Delete multiple files from a bucket in one call.
 */
export async function deleteFiles(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const { error } = await supabase.storage
    .from(bucket)
    .remove(paths);

  if (error) {
    throw new Error(`Storage batch delete failed [${bucket}]: ${error.message}`);
  }
}

/**
 * Download a file from a bucket and return it as a Buffer.
 * Useful for image processing (cropping, resizing) before re-uploading.
 */
export async function downloadFile(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path);

  if (error || !data) {
    throw new Error(`Storage download failed [${bucket}/${path}]: ${error?.message ?? 'no data'}`);
  }

  // Supabase returns a Blob — convert to Buffer for Node.js usage
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
