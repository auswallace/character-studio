import { safeFetch } from '@/lib/safe-url';
import sharp from 'sharp';

/**
 * Download an image from a URL and strip all EXIF/metadata (including C2PA AI labels).
 * Returns the clean image as a JPEG buffer.
 */
export async function stripImageMetadata(imageUrl: string): Promise<Buffer> {
  const res = await safeFetch(imageUrl, { purpose: 'strip-metadata source', trustedProviderUrl: true });
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Re-encode as JPEG with no metadata preserved
  // sharp strips all EXIF, IPTC, XMP, and C2PA metadata by default
  const cleanBuffer = await sharp(inputBuffer)
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();

  return cleanBuffer;
}
