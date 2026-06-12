import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export interface ProcessedPhoto {
  buffer: Buffer;
  contentType: 'image/webp';
  ext: 'webp';
}

/**
 * Normalize an uploaded profile photo: decode (the real content validation —
 * the MIME check upstream is only a fast pre-filter), bake the EXIF
 * orientation into the pixels, center-crop to a square, downscale, and
 * re-encode as WebP. Sharp strips all metadata (EXIF/GPS/ICC) unless
 * `.withMetadata()` is called, so location data never reaches storage —
 * `.rotate()` runs first so orientation survives the strip.
 *
 * 800×800 comfortably covers the largest render (the ID-card avatar at 3×)
 * while keeping the stored object well under 100 KB at quality 80.
 */
export async function processStudentPhoto(
  input: Buffer,
): Promise<ProcessedPhoto> {
  try {
    const buffer = await sharp(input) // default limitInputPixels guards decompression bombs
      .rotate()
      .resize(800, 800, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
    return { buffer, contentType: 'image/webp', ext: 'webp' };
  } catch {
    throw new BadRequestException(
      'Could not read that image. Use a JPEG, PNG, or WebP photo.',
    );
  }
}
