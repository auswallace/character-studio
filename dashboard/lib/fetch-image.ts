import { safeFetch } from '@/lib/safe-url';
import sharp from 'sharp';

/**
 * Download a provider output image and return it as a JPEG buffer.
 * A JPEG passes through byte for byte, so C2PA content credentials (the AI label) stay in the file.
 * Other formats (PNG, WebP) are re-encoded to JPEG, which drops their metadata.
 */
export async function fetchImageAsJpeg(imageUrl: string): Promise<Buffer> {
  const res = await safeFetch(imageUrl, { purpose: 'provider output download', trustedProviderUrl: true });
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

  const input = Buffer.from(await res.arrayBuffer());
  const isJpeg = input.length > 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  if (isJpeg) return input;

  return sharp(input).jpeg({ quality: 95, mozjpeg: true }).toBuffer();
}
